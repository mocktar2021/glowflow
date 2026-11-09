#!/usr/bin/env bash
# Replay GlowFlow's real cleanup migrations in a fresh, disposable PG17 database,
# then stage only inactive Cron metadata in the same disposable CI cluster.
# No hosted database, HTTP request, Vault secret, or live booking is used.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/glow56-extension-fixture.sh"

if [[ "${PGPASSWORD:-}" != 'local-ci-only' ]] ||
   [[ ! "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] ||
   [[ ! "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]]; then
  echo 'Expected the disposable CI password and numeric run identity.' >&2
  exit 1
fi

fixture_db="glowflow_sandbox_test${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
if [[ ! "$fixture_db" =~ ^glowflow_sandbox_test[0-9_]+$ ]] ||
   (( ${#fixture_db} > 63 )); then
  echo 'Invalid disposable database name.' >&2
  exit 1
fi

# Every connection is explicitly pinned to the CI service on loopback. The
# sourced catalog preflight also clears libpq's host-address and service vars.
psql_admin() {
  psql -X -w -v ON_ERROR_STOP=1 -At \
    -h 127.0.0.1 -p 5432 -U supabase_admin -d postgres "$@"
}
psql_test() {
  psql -X -w -v ON_ERROR_STOP=1 -At \
    -h 127.0.0.1 -p 5432 -U postgres -d "$fixture_db" "$@"
}

if [[ "$(psql_admin -c "select rolsuper from pg_roles where rolname='postgres'")" != 'f' ]]; then
  echo 'The disposable postgres role must be non-superuser like hosted GlowFlow.' >&2
  exit 1
fi

# This password and database exist only inside the throwaway GitHub container.
# CREATE DATABASE fails rather than overwriting any existing database.
psql_admin -c "alter role postgres password 'local-ci-only'" >/dev/null
psql_admin -c "create database \"$fixture_db\" with template template0" >/dev/null
cleanup() {
  psql_admin -c "drop database \"$fixture_db\" with (force)" >/dev/null
}
trap cleanup EXIT
# The platform fixture creates schemas and trusted pgcrypto as the hosted
# postgres role. The isolated database is owned by supabase_admin, so grant
# CREATE explicitly rather than giving postgres superuser privileges.
psql_admin -c "grant create on database \"$fixture_db\" to postgres" >/dev/null

if [[ "$(psql_test -c 'select current_user')" != 'postgres' ]]; then
  echo 'The migration test did not connect as postgres.' >&2
  exit 1
fi

# The existing cadence suite applies schema.sql, every ordered standard
# migration, and schema-authorization.sql, then exercises the real sweep RPCs
# and monitor under the intended postgres execution role. Its connection guard
# accepts only this generated localhost sandbox database name.
GLOWFLOW_SANDBOX_TEST_DATABASE_URL="postgresql://postgres:local-ci-only@127.0.0.1:5432/$fixture_db" \
  node --test tests/public-booking-cleanup-cadence.test.mjs

# The cadence test deliberately removes one heartbeat at its end. Running
# each actual sweep once as postgres must restore both completed markers.
psql_test -c 'select public.sweep_public_booking_intents(100)' >/dev/null
psql_test -c 'select public.sweep_public_booking_quota_counters(1000)' >/dev/null
if [[ "$(psql_test -c 'select private.glow56_cleanup_monitor_ready()')" != 't' ]]; then
  echo 'The real cleanup RPCs did not produce two fresh full-sweep markers.' >&2
  exit 1
fi

# Match Supabase's documented Cron installation grants, but only inside the
# disposable database service. No extension or job is installed on GlowFlow.
psql_admin -c 'grant usage on schema cron to postgres; grant all privileges on all tables in schema cron to postgres' >/dev/null
if [[ "$(psql_admin -c "select has_function_privilege('postgres', 'cron.schedule_in_database(text,text,text,text,text,boolean)', 'EXECUTE')")" != 't' ]]; then
  echo 'The intended postgres role cannot call the inactive scheduling API.' >&2
  exit 1
fi

intent_name='glowflow_qa_booking_intent_sweep_v1'
quota_name='glowflow_qa_booking_quota_sweep_v1'
monitor_name='glowflow_qa_booking_cleanup_monitor_v1'
if [[ "$(psql_admin -c "select count(*) from cron.job where jobname in ('$intent_name','$quota_name','$monitor_name')")" != '0' ]]; then
  echo 'A candidate GlowFlow job name already exists in the disposable cluster.' >&2
  exit 1
fi

# All three proposed commands are staged inactive in one transaction. A failed
# postcondition rolls the entire transaction back before the scheduler can
# observe any job. NULL username selects the invoking postgres role rather
# than pg_cron's superuser-only explicit-username path.
psql_admin -v fixture_db="$fixture_db" <<'SQL'
set role postgres;
begin;
select set_config('glow56.fixture_db', :'fixture_db', true);
do $$
begin
  if exists (select 1 from cron.job where jobname in (
      'glowflow_qa_booking_intent_sweep_v1',
      'glowflow_qa_booking_quota_sweep_v1',
      'glowflow_qa_booking_cleanup_monitor_v1')) then
    raise exception 'GlowFlow disposable job-name collision';
  end if;
end;
$$;
select cron.schedule_in_database('glowflow_qa_booking_intent_sweep_v1',
  '* * * * *', 'select public.sweep_public_booking_intents(100);',
  current_setting('glow56.fixture_db'), null, false);
select cron.schedule_in_database('glowflow_qa_booking_quota_sweep_v1',
  '* * * * *', 'select public.sweep_public_booking_quota_counters(1000);',
  current_setting('glow56.fixture_db'), null, false);
select cron.schedule_in_database('glowflow_qa_booking_cleanup_monitor_v1',
  '17,47 * * * *', 'select private.glow56_cleanup_monitor_ready();',
  current_setting('glow56.fixture_db'), null, false);
do $$
declare
  valid_jobs integer;
  total_jobs integer;
begin
  select count(*) into valid_jobs from cron.job
  where database = current_setting('glow56.fixture_db')
    and username = 'postgres' and active = false
    and (
      (jobname = 'glowflow_qa_booking_intent_sweep_v1'
       and schedule = '* * * * *'
       and command = 'select public.sweep_public_booking_intents(100);') or
      (jobname = 'glowflow_qa_booking_quota_sweep_v1'
       and schedule = '* * * * *'
       and command = 'select public.sweep_public_booking_quota_counters(1000);') or
      (jobname = 'glowflow_qa_booking_cleanup_monitor_v1'
       and schedule = '17,47 * * * *'
       and command = 'select private.glow56_cleanup_monitor_ready();'));
  select count(*) into total_jobs from cron.job where jobname in (
    'glowflow_qa_booking_intent_sweep_v1',
    'glowflow_qa_booking_quota_sweep_v1',
    'glowflow_qa_booking_cleanup_monitor_v1');
  if valid_jobs <> 3 or total_jobs <> 3 then
    raise exception 'GlowFlow disposable jobs differ or are active';
  end if;
end;
$$;
commit;
SQL

psql_admin -v fixture_db="$fixture_db" <<'SQL'
set role postgres;
begin;
select set_config('glow56.fixture_db', :'fixture_db', true);
do $$
declare
  job record;
  removed integer := 0;
begin
  for job in select jobid, jobname, command from cron.job
    where database = current_setting('glow56.fixture_db')
      and username = 'postgres' and active = false
      and jobname in ('glowflow_qa_booking_intent_sweep_v1',
        'glowflow_qa_booking_quota_sweep_v1',
        'glowflow_qa_booking_cleanup_monitor_v1')
  loop
    if (job.jobname = 'glowflow_qa_booking_intent_sweep_v1'
        and job.command <> 'select public.sweep_public_booking_intents(100);') or
       (job.jobname = 'glowflow_qa_booking_quota_sweep_v1'
        and job.command <> 'select public.sweep_public_booking_quota_counters(1000);') or
       (job.jobname = 'glowflow_qa_booking_cleanup_monitor_v1'
        and job.command <> 'select private.glow56_cleanup_monitor_ready();') then
      raise exception 'Refusing to unschedule an unexpected job';
    end if;
    perform cron.unschedule(job.jobid);
    removed := removed + 1;
  end loop;
  if removed <> 3 then
    raise exception 'Expected exactly three disposable inactive jobs';
  end if;
end;
$$;
commit;
SQL

if [[ "$(psql_admin -c "select count(*) from cron.job where jobname in ('$intent_name','$quota_name','$monitor_name')")" != '0' ]]; then
  echo 'Disposable candidate jobs remained after scoped cleanup.' >&2
  exit 1
fi
echo 'PG17 full-migration replay, postgres cleanup calls, and inactive candidate jobs passed.'

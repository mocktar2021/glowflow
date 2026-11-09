#!/usr/bin/env bash
# This test runs only against the pinned disposable GitHub Actions service.
# An active collision row exists only inside a rolled-back transaction, so
# the scheduler cannot see it. No GlowFlow cleanup function is invoked.
set -euo pipefail

# Reuse the exact version gate and loopback-only libpq setup. This script is
# never pointed at hosted Supabase and has only a dummy local password.
source "$(dirname "${BASH_SOURCE[0]}")/glow56-extension-fixture.sh"

if [[ ! "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] ||
   [[ ! "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]]; then
  echo "Expected numeric GitHub run identity for disposable job names." >&2
  exit 1
fi

fixture_suffix="${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
inactive_name="glow56_ci_inactive_${fixture_suffix}"
collision_name="glow56_ci_collision_${fixture_suffix}"

# The extension and every job below belong only to the temporary container.
# Installing pg_cron here never applies a migration to hosted GlowFlow.
psql_fixture -c 'create extension pg_cron with schema pg_catalog'
installed_version="$(psql_fixture -c "select extversion from pg_extension where extname='pg_cron'")"
if [[ "$installed_version" != '1.6.4' ]]; then
  echo "Disposable pg_cron extension version mismatch." >&2
  exit 1
fi

function_ready="$(psql_fixture -c "select to_regprocedure('cron.schedule_in_database(text,text,text,text,text,boolean)') is not null")"
function_allowed="$(psql_fixture -c "select has_function_privilege(current_user, 'cron.schedule_in_database(text,text,text,text,text,boolean)', 'EXECUTE')")"
if [[ "$function_ready" != 't' ]] || [[ "$function_allowed" != 't' ]]; then
  echo "The disposable pg_cron inactive scheduling API is unavailable to the fixture role." >&2
  exit 1
fi

# A same-name upsert changes the command but retains an existing active flag.
# The active row is never committed, even if this assertion fails.
psql_fixture -v fixture_name="$collision_name" <<'SQL'
begin;
select set_config('glow56.fixture_name', :'fixture_name', true);
do $$
begin
  if exists (select 1 from cron.job where jobname = current_setting('glow56.fixture_name')) then
    raise exception 'Disposable collision job name already exists';
  end if;
end;
$$;
select cron.schedule_in_database(current_setting('glow56.fixture_name'), '5 seconds',
  'select 1 /* glow56_disposable_collision */', current_database(), current_user, true);
select cron.schedule_in_database(current_setting('glow56.fixture_name'), '5 seconds',
  'select 2 /* glow56_disposable_collision */', current_database(), current_user, false);
do $$
declare
  found_job record;
begin
  select jobid, active, command, database, username into found_job
  from cron.job where jobname = current_setting('glow56.fixture_name');
  if not found then
    raise exception 'Same-name collision job is missing';
  end if;
  if found_job.active is distinct from true
     or found_job.command is distinct from 'select 2 /* glow56_disposable_collision */'
     or found_job.database is distinct from current_database()
     or found_job.username is distinct from current_user then
    raise exception 'Same-name upsert did not preserve the active flag as expected';
  end if;
end;
$$;
rollback;
SQL

collision_count="$(psql_fixture -v fixture_name="$collision_name" <<< \
  "select count(*) from cron.job where jobname = :'fixture_name';")"
if [[ "$collision_count" != '0' ]]; then
  echo "Rolled-back collision job became visible." >&2
  exit 1
fi

# Native active=false must insert a dormant row in a single transaction. A
# failed postcondition aborts before commit, so no active job is exposed.
psql_fixture -v fixture_name="$inactive_name" <<'SQL'
begin;
select set_config('glow56.fixture_name', :'fixture_name', true);
do $$
begin
  if exists (select 1 from cron.job where jobname = current_setting('glow56.fixture_name')) then
    raise exception 'Disposable inactive job name already exists';
  end if;
end;
$$;
select cron.schedule_in_database(current_setting('glow56.fixture_name'), '5 seconds',
  'select 1 /* glow56_disposable_inactive */', current_database(), current_user, false);
do $$
declare
  found_job record;
begin
  select jobid, active, command, schedule, database, username into found_job
  from cron.job where jobname = current_setting('glow56.fixture_name');
  if not found then
    raise exception 'Native inactive job is missing';
  end if;
  if found_job.active is distinct from false
     or found_job.command is distinct from 'select 1 /* glow56_disposable_inactive */'
     or found_job.schedule is distinct from '5 seconds'
     or found_job.database is distinct from current_database()
     or found_job.username is distinct from current_user then
    raise exception 'Native active=false failed its pre-commit postcondition';
  end if;
end;
$$;
commit;
SQL

job_id="$(psql_fixture -v fixture_name="$inactive_name" <<< \
  "select jobid from cron.job where jobname = :'fixture_name' and username = current_user;")"
if [[ ! "$job_id" =~ ^[0-9]+$ ]]; then
  echo "Expected one disposable inactive job ID." >&2
  exit 1
fi

# Two five-second intervals are enough to catch accidental activation. This
# is a CI observation, not proof of hosted scheduler or alert delivery.
sleep 12
active="$(psql_fixture -v fixture_id="$job_id" <<< \
  "select active from cron.job where jobid = :'fixture_id'::bigint;")"
run_count="$(psql_fixture -v fixture_id="$job_id" <<< \
  "select count(*) from cron.job_run_details where jobid = :'fixture_id'::bigint;")"
if [[ "$active" != 'f' ]] || [[ "$run_count" != '0' ]]; then
  echo "Disposable inactive job activated or recorded a run." >&2
  exit 1
fi

# Unschedule only the exact ID and immutable fixture command. Never delete
# another pg_cron job or its run history.
psql_fixture -v fixture_id="$job_id" -v fixture_name="$inactive_name" <<'SQL'
begin;
select set_config('glow56.fixture_name', :'fixture_name', true);
select set_config('glow56.fixture_id', :'fixture_id', true);
do $$
declare
  removed boolean;
begin
  select cron.unschedule(jobid) into removed
  from cron.job
  where jobid = current_setting('glow56.fixture_id')::bigint
    and jobname = current_setting('glow56.fixture_name')
    and command = 'select 1 /* glow56_disposable_inactive */'
    and username = current_user
    and active = false;
  if removed is distinct from true then
    raise exception 'Exact disposable inactive job was not unscheduled';
  end if;
end;
$$;
commit;
SQL

remaining="$(psql_fixture -v fixture_id="$job_id" <<< \
  "select count(*) from cron.job where jobid = :'fixture_id'::bigint;")"
if [[ "$remaining" != '0' ]]; then
  echo "Disposable inactive job remained after scoped cleanup." >&2
  exit 1
fi

echo "Disposable pg_cron inactive insert, no-run observation, collision hazard, and scoped cleanup passed."

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
psql -X -w -v ON_ERROR_STOP=1 -At \
  -h 127.0.0.1 -p 5432 -U supabase_admin -d "$fixture_db" \
  -c 'grant create on schema public to postgres' >/dev/null

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

# Use the pinned Supabase image's actual post-install Cron ACLs. In
# particular, postgres must not need direct writes to cron.job; the supported
# schedule_in_database API is the only path exercised below.
cron_acl="$(psql_admin -c "select has_schema_privilege('postgres','cron','USAGE'), has_table_privilege('postgres','cron.job','SELECT'), has_table_privilege('postgres','cron.job','INSERT,UPDATE,DELETE')")"
if [[ "$cron_acl" != 't|t|f' ]]; then
  echo "Unexpected disposable Cron ACLs for postgres: $cron_acl" >&2
  exit 1
fi
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

# Execute the same reviewed SQL files proposed for a future exact-scope
# operator action. This run is confined to a disposable CI service/database.
# NULL username selects postgres; both scripts reject missing approval vars.
if psql_admin -v glow56_target_db="$fixture_db" \
  -v glow56_exact_approval='wrong-context' \
  -f ops/glow56-stage-inactive-cron.psql >/dev/null 2>&1; then
  echo 'Inactive staging accepted an incorrect approval context.' >&2
  exit 1
fi
if [[ "$(psql_admin -c "select count(*) from cron.job where jobname in ('$intent_name','$quota_name','$monitor_name')")" != '0' ]]; then
  echo 'Incorrect approval context left a disposable candidate job.' >&2
  exit 1
fi
psql_admin -v glow56_target_db="$fixture_db" \
  -v glow56_exact_approval='GLOW-56-INACTIVE-ONLY' \
  -f ops/glow56-stage-inactive-cron.psql
if [[ "$(psql_admin -c "select count(*) from cron.job_run_details where jobid in (select jobid from cron.job where jobname in ('$intent_name','$quota_name','$monitor_name'))")" != '0' ]]; then
  echo 'An inactive disposable candidate unexpectedly recorded a run.' >&2
  exit 1
fi
psql_admin -v glow56_target_db="$fixture_db" \
  -v glow56_exact_approval='GLOW-56-INACTIVE-ONLY' \
  -f ops/glow56-unstage-inactive-cron.psql

if [[ "$(psql_admin -c "select count(*) from cron.job where jobname in ('$intent_name','$quota_name','$monitor_name')")" != '0' ]]; then
  echo 'Disposable candidate jobs remained after scoped cleanup.' >&2
  exit 1
fi
echo 'PG17 full-migration replay, postgres cleanup calls, and inactive candidate jobs passed.'

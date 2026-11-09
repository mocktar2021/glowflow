#!/usr/bin/env bash
# Inspect only the disposable GitHub Actions Postgres service. Do not install
# extensions, apply migrations, schedule jobs, or make HTTP requests here.
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  echo "This fixture is restricted to GitHub Actions." >&2
  exit 1
fi

: "${PGPASSWORD:?The disposable fixture password is required}"

# libpq can use PGHOSTADDR as the actual network target even when PGHOST is
# localhost. Clear service-file routing too, then pass explicit loopback
# connection arguments on every invocation.
unset PGHOSTADDR PGSERVICE PGSERVICEFILE
export PGHOST=127.0.0.1
export PGPORT=5432
export PGUSER=supabase_admin
export PGDATABASE=postgres
export PGSSLMODE=disable

psql_fixture() {
  psql -X -A -t -v ON_ERROR_STOP=1 \
    -h 127.0.0.1 -p 5432 -U supabase_admin -d postgres "$@"
}

server_version="$(psql_fixture -c 'SHOW server_version_num')"
if [[ "$server_version" != "170006" ]]; then
  echo "Expected disposable PostgreSQL 17.6; found server_version_num=$server_version" >&2
  exit 1
fi

# pg_available_extensions reports both the installed version (if any) and
# the default version compiled into this image. An installed version that
# differs from the expected one is also a failure.
actual="$(psql_fixture -F '|' -c "
  SELECT name, default_version, COALESCE(installed_version, 'not-installed')
  FROM pg_available_extensions
  WHERE name IN ('pg_cron', 'pg_net', 'supabase_vault')
  ORDER BY name
")"

echo "Disposable PostgreSQL $server_version extension catalog:"
echo "$actual"

expected_names=$'pg_cron\npg_net\nsupabase_vault'
actual_names="$(printf '%s\n' "$actual" | cut -d '|' -f 1)"
if [[ "$actual_names" != "$expected_names" ]]; then
  echo "The required extension set is incomplete or unexpected." >&2
  exit 1
fi

while IFS='|' read -r name default_version installed_version; do
  case "$name" in
    pg_cron) expected_version=1.6.4 ;;
    pg_net) expected_version=0.20.4 ;;
    supabase_vault) expected_version=0.3.1 ;;
    *) echo "Unexpected extension: $name" >&2; exit 1 ;;
  esac
  if [[ "$default_version" != "$expected_version" ]] ||
     [[ "$installed_version" != "not-installed" && "$installed_version" != "$expected_version" ]]; then
    echo "$name must be available at $expected_version and not installed at a different version." >&2
    exit 1
  fi
done <<< "$actual"

echo "Exact PG17, pg_cron, pg_net, and Vault catalog preflight passed. No job was created."

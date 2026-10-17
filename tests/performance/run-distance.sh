#!/usr/bin/env bash
set -euo pipefail

# Synthetic, local-only benchmark. Never connects to a hosted database.
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container_name="glow46-distance-bench-$$"

cleanup() {
  docker stop "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm -d --name "$container_name" \
  -e POSTGRES_PASSWORD=glow46-local-only \
  postgis/postgis@sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6 >/dev/null

for attempt in {1..45}; do
  # The image starts a temporary Unix-socket server during initialization.
  # TCP readiness waits for the final post-initialization server instead.
  if docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    break
  fi
  if (( attempt == 45 )); then
    echo 'Local PostgreSQL container did not become ready.' >&2
    exit 1
  fi
  sleep 1
done

docker exec "$container_name" createdb -U postgres -T template0 glow46perf
psql_local() {
  docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d glow46perf "$@"
}

psql_local -f - < "$repo_dir/tests/supabase-platform-fixture.sql" >/dev/null
psql_local -f - < "$repo_dir/supabase/schema.sql" >/dev/null
for migration in "$repo_dir"/supabase/migrations/*.sql; do
  psql_local -f - < "$migration" >/dev/null
done
psql_local -f - < "$repo_dir/tests/performance/distance-seed.sql" >/dev/null

psql_local -Atc "select 'published=' || count(*) from public.salon_public_profiles where is_published"
psql_local -Atc "select 'postgis=' || extversion from pg_extension where extname = 'postgis'"
psql_local -v bench_jit=off -f - < "$repo_dir/tests/performance/distance-measure.sql"
psql_local -f - < "$repo_dir/tests/performance/distance-explain.sql"

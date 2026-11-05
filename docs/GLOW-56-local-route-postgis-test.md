# GLOW-56 disposable route-to-PostGIS seam

`tests/public-booking-v2-postgis.test.mjs` invokes the **production v2 Next.js
route function** with synthetic `NextRequest` objects and a signed test cookie.
The route's quota and intent RPC calls run against real migrated PostgreSQL
functions through a test-only `psql` service-role adapter. The database is
created by `tests/rls-run.mjs` on loopback with a generated
`glowflow_route_postgis_test_*` name, loaded with the repository schema and
ordered migrations, and dropped after the test. Fixture names and addresses
use `example.invalid`; policy rows exist only inside that disposable database.

The seam checks one confirmed appointment after commit, exact-intent
reconciliation and replay, one real 429 quota denial with no new intent or
appointment, and a second prepared intent that is canceled and cannot later
commit. It uses the existing `postgis/postgis:16-3.4` security CI service. It
does not call hosted Supabase or create a live booking.

This is **not** a browser, PostgREST, Vercel header, or hosted deployment
end-to-end test. The adapter deliberately does not emulate optional
PostgREST table reads for confirmation enrichment; those stay covered by
separate route unit tests. The synthetic `VERCEL_ENV` and forwarding headers
exercise local key construction, not Vercel's trusted-header behavior.
Browser cookie storage, `__Host` enforcement, lost-response recovery UX,
real Vercel forwarding, quota concurrency and cleanup operations, and hosted migration preflight
remain separate activation gates. Keep v2 disabled.

The integration test is opt-in outside security CI. It requires
`GLOWFLOW_ROUTE_POSTGIS_TEST_DATABASE_URL` to name a fresh loopback database
matching `glowflow_route_postgis_test_*`; it refuses any other URL and checks
for pre-existing non-system application schemas, tables, views, functions,
sequences, and types before loading migrations. Only PostGIS extension-owned
objects are allowed. The platform fixture may create cluster-wide test roles,
so run this only on a **disposable local PostgreSQL instance**, never a shared
local cluster, hosted service, or existing application database.

# GLOW-56 recovery-only local route prototype

`tests/recovery-only-postgis-run.mjs` creates a generated database on a
disposable loopback PostgreSQL/PostGIS instance. It loads the repository schema,
ordered migrations, fictional booking fixture, and then explicitly applies
`GLOW-56-booking-contract-gate.sql` from this prototype directory. That SQL is
**not a migration** and must not be applied to hosted Supabase. The runner
transitions the local gate from `legacy` to `frozen` to `v2`, and always drops
the generated database afterward. The platform fixture may create cluster
roles, so the whole PostgreSQL instance must be disposable.

The test seeds two prepared intents and one empty browser session through the
real local RPCs, then transitions the database to `v2_no_prepares`. A local
Next.js server re-exports the production v2 and legacy POST handlers, using
only a test-only `psql` adapter and random local signing keys. It verifies:

- No-cookie bootstrap and new prepare/no-ID reconcile do not create a session,
  intent, appointment, or quota hit; the SQL gate independently denies new
  preparation and session bootstrap.
- Two exact, cryptographically signed cookie intents can still reconcile;
  one commits once and the other cancels without creating an appointment.
- The legacy v1 POST returns 410 throughout recovery-only admission.

This is local Next HTTP route plus disposable PostgreSQL evidence. It does not
exercise a browser cookie jar, hosted Supabase/PostgREST, Vercel's trusted
forwarding, or any deployment. Both v2 flags stay OFF by default outside the
short-lived test server. No scheduler, payment, or hosted booking is involved.

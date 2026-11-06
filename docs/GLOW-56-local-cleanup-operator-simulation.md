# GLOW-56 local cleanup operator simulation

This is a **disposable local PostGIS QA drill**, not a scheduler installation or
permission to activate v2. No hosted Supabase SQL, Vercel cron, GitHub schedule,
secret, alert destination, or production policy is configured by this branch.
Do not run it against `rfwhqutkiztxkagbhevp` or any other hosted database.

Run `node tests/rls-run.mjs` with `GLOWFLOW_RLS_ADMIN_DATABASE_URL` pointed at
an explicit loopback PostgreSQL `/postgres` database and `PSQL_BIN` pointed at
a local PostgreSQL client. The runner creates a uniquely named
`glowflow_sandbox_test_*` database, runs
`public-booking-cleanup-cadence.test.mjs`, and drops that database. It rejects
non-loopback URLs and never accepts a database name for deletion from a user.
The existing Database security CI service is `postgis/postgis:16-3.4`.

The test seeds fictional quota and intent policies only inside that disposable
database. Its clock simulation ages the two `last_full_sweep_at` markers by
30, 90, and 121 minutes. It verifies that the bootstrap quota gate and new
preparation stay open at 90 minutes, enter an operator warning window with
under 30 minutes of margin, then fail closed after two hours. It also verifies
that a rolled-back run does not refresh a marker, that one-row partial sweeps
clear the marker, and that bounded repeats restore it only after the backlog
is fully drained.
Expired prepared contact data must be scrubbed before preparation resumes.
These are database-contract checks; they do not prove hosted cron timing,
notification delivery, or Preview isolation. In particular, they do not prove
that no-ID reconciliation cannot create a browser session during a pause;
that separate recovery-only gate is specified in draft #210.

Candidate eventual operations review, **not implemented here**:

1. Every 30 minutes, invoke each sweep with reviewed batch limits. Repeat a
   busy or incomplete sweep within a bounded budget; do not report success
   until both return `complete: true` and both markers are current. A busy
   result is not a completed run.
2. Independently inspect both markers and failures often enough to warn before
   two hours, with a candidate warning at 90 minutes. Name an on-call owner
   and test the alert path. A monitor sharing the same failed scheduler cannot
   reliably detect that scheduler's total outage. Existing no-added-cost
   schedulers do not guarantee a pre-deadline alert.
3. Treat `booking_quota_cleanup_stale` and `booking_intent_cleanup_stale` as
   deliberate fail-closed signals. Do not bypass them to restore bookings.
   Existing-intent reconciliation retains its separately bounded recovery
   path. Stop activation if backlog cannot complete before freshness expires.

Hosted migration, policy values, scheduler, monitoring credentials, and v2
activation each require separate exact-scope approval and a verified isolated
QA environment. Generic Preview must not be enabled against an unverified
shared main database. The only no-added-cost QA environment verified here is
disposable local PostGIS.

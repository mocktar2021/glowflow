# GLOW-56 browser to disposable PostGIS prototype

The dedicated `booking-postgis` CI job creates a generated database on its
disposable loopback PostGIS service, loads the repository schema and fictional
fixtures, runs one Chromium booking test, and drops the database in `finally`.
The platform fixture may create cluster roles, so never run its runner against
a shared local PostgreSQL instance. Direct invocation of the browser test is
unsupported; its runner creates a nonce marker inside the fresh database and
passes the matching nonce to the browser process.

The browser uses the real `LiveBookingFlow` and sends POSTs to a local Next.js
route that re-exports the unchanged production v2 handler. Only in the browser
fixture, the admin client is aliased to a test-only `psql` service-role RPC
adapter. The availability GET returns two slots queried from the same disposable
database. The test offers both fixture slots, lets the first commit finish
in PostgreSQL, then drops only its browser response. It checks that the
alternate choice is locked, a forced second submit does nothing, the visitor's
explicit Check reconciles the exact original intent, and exactly one
appointment exists.

The `__Host` Secure HttpOnly cookie must actually persist in Chromium; a
localhost cookie failure fails this test rather than substituting a fake
cookie. The test's `x-forwarded-for` is synthetic, so this is **not** proof of
Vercel's trusted forwarding, PostgREST, hosted Supabase, or a production
deployment. It creates no hosted booking and does not activate v2.

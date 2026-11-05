# GLOW-56 browser to disposable PostGIS prototype

The dedicated `booking-postgis` CI job creates a generated database on its
disposable loopback PostGIS service, loads the repository schema and fictional
fixtures, runs one Chromium booking test, and drops the database in `finally`.
The platform fixture may create cluster roles, so never run its runner against
a shared local PostgreSQL instance.

The browser uses the real `LiveBookingFlow` and sends POSTs to a local Next.js
route that re-exports the unchanged production v2 handler. Only in the browser
fixture, the admin client is aliased to a test-only `psql` service-role RPC
adapter. The availability GET returns a slot queried from the same disposable
database. The test lets the first commit finish in PostgreSQL, drops only its
browser response, then checks that the visitor's explicit Check reconciles the
exact original intent and that exactly one appointment exists.

The `__Host` Secure HttpOnly cookie must actually persist in Chromium; a
localhost cookie failure fails this test rather than substituting a fake
cookie. The test's `x-forwarded-for` is synthetic, so this is **not** proof of
Vercel's trusted forwarding, PostgREST, hosted Supabase, or a production
deployment. It creates no hosted booking and does not activate v2.

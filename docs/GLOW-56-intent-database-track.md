# GLOW-56 local booking-intent database track

This branch is a dormant migration and disposable-database test proposal. It
does not seed `private.public_booking_intent_policy`, alter the legacy booking
route, apply hosted SQL, or activate v2. A separate privacy and operations
decision chose a two-hour prepared intent, 24-hour browser cookie, and three-day
terminal-record retention. No hosted policy row is inserted by this migration.
The disposable test fixture alone seeds the chosen two-hour/three-day policy.

The six service-role-only public RPCs are `prepare_public_booking_intent`,
`commit_public_booking_intent`, `reconcile_public_booking_intent`,
`cancel_public_booking_intent`, `acknowledge_public_booking_intent`, and
`sweep_public_booking_intents`. The visitor RPCs
accept only a SHA-256 hash of the HttpOnly browser cookie, never its raw token.
`prepare` also requires the generation UUID returned by an initial no-ID
`reconcile`. The database locks the browser+tenant session before the intent;
generation rotates atomically at cancellation, expiry, and acknowledgement.
A delayed prepare bearing the old generation cannot mint a new request key.
Each intent stores the generation at its terminal release so a repeated old
response cannot return a later generation from a newer booking cycle.

`commit` and terminal transitions share one lock order: browser advisory lock,
browser-session row, then exact intent row. Appointment creation and marking
the intent committed are one database transaction. Reconciliation of a stored
appointment does not depend on the current booking time or catalog status.
`none` from no-ID reconciliation means only that this cookie has no current
prepared or unacknowledged committed intent. A supplied but missing intent ID
always returns `unknown`, never permission to rebook. The browser's per-intent
nonsecret marker is necessary to distinguish a lost cookie from a truly new
browser after reload.

New preparations fail closed unless a complete bounded cleanup sweep finished
within the prior two hours. The sweep processes at most 1-100 intent/session
rows per call, clears its freshness heartbeat before work, and refreshes it
only when no due rows remain. An abandoned prepared intent expires at the
earlier of its two-hour TTL and slot start; the sweep rotates its generation
and clears name, phone, and email even when the policy singleton is absent.
Separate index-backed passes scrub due prepared rows before purging retained
terminal rows, so a large terminal backlog cannot delay contact-data cleanup.
Terminal intents are retained for three days before deletion, and orphaned
browser-session hashes are removed only after three days and cookie expiry.
The database rejects a known session older than 24 hours. The API must also
reject signed-cookie replay after hash cleanup; a database hash alone cannot
distinguish a purged old raw cookie from a new token.

## Activation blockers

- The migration installs a bounded cleanup RPC, but no scheduler invokes it.
  Before enabling v2, review an operator, cadence under two hours, backlog
  drain, failure alert, and runtime proof that the freshness gate fails closed.
  Do not schedule or activate it in this branch. A partial sweep does not
  refresh the gate.
- Review and separately approve the policy seed, RLS/grants,
  and hosted migration preflight separately. This branch authorizes none.
- Drain or gate the arbitrary-key legacy `/api/public-booking` POST before
  claiming durable v2 protection. Already-started legacy requests must finish;
  rollback must preserve v2 commit/reconcile/cancel until existing intents
  drain. The provided rollback refuses to drop any intent or seeded policy row.
- Run the disposable PostgreSQL concurrency/security suite on the exact PR
  head and review failures before merge. The local container was stopped after
  shared overlay disk exhaustion; local race tests are not claimed verified.

Full browser-data clearing and truly simultaneous first visits before one
shared cookie exists remain outside the same-browser MVP guarantee.

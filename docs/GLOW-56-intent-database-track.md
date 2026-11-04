# GLOW-56 local booking-intent database track

This branch is a dormant migration and disposable-database test proposal. It
does not seed `private.public_booking_intent_policy`, alter the legacy booking
route, apply hosted SQL, or activate v2. A separate privacy and operations
decision must approve the exact prepared-intent TTL, cookie TTL, and retention
before any hosted policy row is inserted. The disposable test fixture alone
seeds proposed 24-hour and 7-day values; those are not production defaults.

The five server-only public RPCs are `prepare_public_booking_intent`,
`commit_public_booking_intent`, `reconcile_public_booking_intent`,
`cancel_public_booking_intent`, and `acknowledge_public_booking_intent`. They
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

## Activation blockers

- The migration deliberately has no scheduled expiry or retention cleanup.
  Prepared contact data is scrubbed on an invoked terminal transition, but an
  abandoned intent would otherwise retain it indefinitely. Before enabling
  v2, add and locally test a bounded cleanup worker that takes the same
  browser-session and intent locks, rechecks wall time, rotates generation
  exactly once on expiry, scrubs contact fields, and prunes terminal rows only
  after the approved retention period. Do not schedule it in this branch.
  The worker must also delete browser-session hash/generation rows only after
  the cookie lifetime plus a safe grace period and after no intent references
  them; session cleanup must never make an old generation valid again.
- Review and approve exact TTL/retention values, the policy seed, RLS/grants,
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

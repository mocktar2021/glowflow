# GLOW-56 recovery-only booking admission (design only)

Status: proposal, not implemented or approved for activation. Reviewed against
the dormant application draft #203 at `6b67134b0093ab3ef1916eeb57d5cc84406c45f8`,
the separate intent database draft #197, and the legacy cutover design in
`GLOW-56-legacy-cutover-gate.md` (draft #194). This document changes no route,
configuration, database, policy, or booking. The v2 public booking flag remains
off. Do not implement or activate a partial recovery-only mode without the
reviewed versioned SQL gate, disposable-database race tests, and a separate
owner decision on the booking pause and unresolved legacy requests.

## Why a separate admission state is needed

`lib/public-booking-v2-config.ts` currently exposes one boolean. When it is
true, `POST /api/public-booking` returns `410 booking_contract_changed`; when
false, `POST /api/public-booking/v2` returns 404. The booking page uses the same
boolean to choose its client flow. Turning the boolean off after any v2 intent
has been accepted would strand signed-cookie recovery and could reopen the
legacy request-key creation path in a current or older deployment. The
application flag is not a transaction fence; an in-flight v1 RPC or a direct
service-role call can outlive a route change.

The proposed server-only admission contract distinguishes these states:

| Admission state | Legacy v1 POST | New v2 cookie or prepare | Existing v2 intent recovery |
| --- | --- | --- | --- |
| `legacy` | Allowed only before the database has ever entered v2 | Closed | Closed |
| `v2` | Exact 410, with old-page manual guidance | Allowed only with approved policy, quota, and healthy cleanup | Reconcile, commit, cancel, acknowledge allowed |
| `v2_no_prepares` | Exact 410 | No new cookie, session, or prepare | Valid existing-cookie bootstrap and existing-intent reconcile, commit, cancel, acknowledge remain available |
| Missing or invalid v2 configuration after cutover | Closed, never silently legacy | Closed | Preserve the existing-cookie recovery path where its prerequisites remain valid |

The mode resolver must fail closed on unknown or contradictory values and must
not infer `v2` from a loosely parsed truthy string. A missing setting can keep
today's pre-activation `legacy` default only while the database still proves
it has never entered v2. Application code alone cannot know that durable fact;
the database gate's `ever_v2` marker is authoritative. This design does not
authorize any environment-variable change or claim that a reverted old build
will obey a new resolver.

## Recovery-only route and UI contract

The v2 route must stay present in `v2_no_prepares`. A bootstrap with a valid,
unexpired, host-bound signed cookie may report that the existing browser
capability is ready, but must not mint or refresh a cookie. A missing cookie
cannot receive a new capability; a rejected cookie remains an unresolved 409,
not a fresh session. Reject `prepare` before quota or intent RPC work. Keep
exact-intent `reconcile`, `commit`, `cancel`, and `acknowledge` available under
their existing cookie validation, tenant/intent binding, and action quotas.
Do not remove signing or quota keys during the recovery window. No action may
fall back to v1 appointment creation.

There is a database blocker to allowing **no-ID reconciliation** in this
state. The current `reconcile_public_booking_intent` calls
`private.lock_public_booking_browser_session(..., intent_id is null)`;
that helper inserts a browser-session row when no row exists and its bootstrap
argument is true (`20261104184112_glow56_private_public_booking_intents.sql`,
lines 601-603 and 170-173 in draft #197). A valid signed cookie alone does not
prove the session was previously used. Until a reviewed versioned SQL gate
makes no-ID reconciliation read an existing session without insertion in
`v2_no_prepares`, the HTTP route must reject no-ID reconcile. That temporary
restriction also means a cookie-only visitor who lost the local intent marker
cannot be promised automatic recovery. Therefore a code-only tri-state shell
is **not** an activation-ready rollback path.

`app/[locale]/book/[slug]/page.tsx` must render the v2 recovery flow in both
v2 states, never a legacy form in `v2_no_prepares`. The client must not unlock
the new-booking form after a `none` result in recovery-only mode, including
when an already-loaded tab has stale admission state. Fresh visitors should
see localized pause guidance without a false claim that a booking was sent.
Exact pending markers remain locked through 409, 429, 503, and unknown
outcomes. A prepared intent may offer the existing explicit Finish action only
where the same mounted tab still holds and displays its original immutable
non-contact summary; reload or another tab without that summary must show
Check, Cancel, or manual salon support, not a blind Finish. The generic Check
action stays non-booking. Old v1 pages receiving the exact 410 retain their
original request key and show FR/EN/ES manual verification guidance; they
cannot submit a changed key or assume an earlier ambiguous request failed.

The server route, not a rendered page or a client flag, is the admission
authority. A stale page may still attempt a POST after a mode transition;
the route and ultimately the database must reject new creation.

## Cutover, rollback, and proof required before hosting

The database design requires a transactional `legacy -> frozen -> v2`
transition. The freeze must wait for v1 transactions holding the shared gate
lock and must block old deployments and direct legacy RPC calls, not merely
new HTTP admission. V2 commit needs a private appointment executor so the
legacy wrapper can be fenced without breaking intent-bound commit. The
private intent/session grants and lock order must be reviewed before claiming
that every insertion path is covered. A failed freeze leaves v2 off and must
not be described as a completed drain.

Once v2 accepts an intent, rollback is `v2 -> v2_no_prepares`, never back to
`legacy` or a legacy-only deployment. Keep valid signed cookies and existing
intent recovery available for the approved 24-hour cookie window, and retain
terminal intent records for the approved three days. Recovery-only must keep
quota and cleanup operations healthy; it is not permission to disable abuse
limits. The owner must separately choose a bounded public-booking pause and
manual salon support or a reviewed request-key-only lookup for unresolved v1
attempts. No old ambiguous request may be reinterpreted as a new v2 intent.

Before any hosted change, test the admission matrix and malformed settings in
route and FR/EN/ES browser fixtures. In disposable PostgreSQL, prove no-ID
reconcile cannot insert a session in `v2_no_prepares`, new prepare fails,
existing-intent recovery works, and the operator freeze waits for in-flight
legacy work. Exercise an old-page 410, older deployment/direct RPC, lock
timeout, and rollback with v2 recovery still present. Then require a fresh
GlowFlow-only identity, migration-ledger, schema, privilege, and fingerprint
preflight, separate approval for the exact SQL, and isolated end-to-end QA.
No SQL, `db push`, environment setting, feature flag, deployment, booking,
payment, message, or MowFlow action is authorized by this design.

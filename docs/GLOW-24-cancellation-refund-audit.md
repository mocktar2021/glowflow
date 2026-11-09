# GLOW-24 cancellation, refund, and no-show audit

Status: **draft policy contract, not an enabled refund or no-show feature**. No Stripe write API, appointment mutation, SQL execution, hosted setting, or customer message was used for this audit. Do not merge this draft as GLOW-24 completion.

## Current behavior and gaps

| Area | Existing behavior | Missing for GLOW-24 |
| --- | --- | --- |
| Cancellation | `cancel_calendar_appointment` lets an authenticated tenant member move a confirmed appointment to canceled. The calendar action validates the UUID and uses the signed-in member session. Existing local database coverage confirms cancellation does not silently change payment ledger totals. For a canceled appointment with a paid deposit, the calendar keeps a factual FR/EN/ES note that cancellation alone did not refund it and any refund must be verified separately. | No tenant-configured cutoff, deposit outcome, actor/reason/timestamp audit, client self-service path, or booking-time policy snapshot. |
| Public policy text | `salon_public_profiles.policies_json` is owner-edited and displayed in FR/EN/ES with fallback. Confirmation enrichment reads it from the public profile. | This is mutable free text, not machine-readable cancellation windows or deposit rules. Confirmation enrichment is not persisted as a policy version bound to the booking. The three translations are not guaranteed complete. |
| No-show | `appointments.status` permits `no_show`, but the calendar has no controlled no-show action. | No authorized transition, time gate, reason/actor audit, or explicit deposit-retention decision. A tenant member currently has broad direct `appointments` UPDATE access under RLS; the existing status column alone is not an auditable no-show workflow. |
| Payment/refund ledger | `payment_entries` is append-only, tenant-scoped, owner-only for authenticated inserts, and serializes refunds against total paid. Manual payment UI records cash or externally processed card payments. | A ledger `refund` entry does not prove money moved. Direct owner insertion of a cash/external-card refund can be recorded against an appointment with a different tender. There is no per-original-payment allocation or verified Stripe refund reference and state. |
| Stripe sandbox | Signed webhooks process Checkout payment/expiration events into reservation state; production and alternate configurations fail closed. | No refund write API or refund webhook reconciliation. A paid sandbox reservation is not automatically a verified `payment_entries` payment. No authorized, idempotent refund command exists. |

The tests in `tests/cancellation-refund-contract.test.mjs` freeze the current separation: cancellation has no financial side effect, and refund webhook events are not interpreted as settled booking events. They are a guard against accidentally calling a status change a refund, not proof that GLOW-24 is implemented.

## Required owner decisions before implementation

1. Set the cancellation cutoff and time zone rule: salon-local booking start versus request timestamp, daylight-saving boundaries, same-day bookings, and whether owners may grant exceptions. Define the effective policy for bookings made before a salon changes its rules.
2. Define deposit outcomes for timely cancellation, late cancellation, salon-initiated cancellation, reschedule, no-show, and partial service. Specify whether a refund is automatic or always requires an owner decision, and whether fees/taxes affect the amount. Preserve mandatory local consumer rights.
3. Define who may cancel, mark no-show, approve/refuse a refund, and correct a mistaken status. Decide the event history to retain: actor, reason, policy version, timestamps, amounts, provider IDs, and reversal/correction events. Staff must not gain an implicit Stripe refund capability merely because they can cancel an appointment.
4. Decide whether only the original tender can be refunded, how mixed cash/card/Stripe payments are allocated, and what counts as a verified external-card or cash refund. A Stripe refund ledger entry must follow provider confirmation, not precede or substitute for it.
5. Approve customer-facing policy wording and fallback for FR, EN, and ES, and where it must be shown before deposit payment. A public profile paragraph alone is insufficient to calculate or prove the applicable financial rule.

## Safe implementation gate after policy approval

- Add a versioned, tenant-owned policy and booking-time immutable policy snapshot with RLS and owner-only configuration. Migration and rollback must be reviewed separately; never infer an old booking's rule from the current profile text.
- Introduce a scoped status-transition RPC with tenant, actor, current-state, time, and policy checks plus append-only events. Separate cancellation/no-show state from refund outcome. Test owner, staff, anonymous, and cross-tenant paths and concurrent requests in local PostgreSQL.
- Introduce a dedicated owner-authorized refund request and state machine. Validate appointment, original tender/provider account/payment identity, maximum refundable amount, currency, connected account, and idempotency key before any provider call. Reconcile signed Stripe refund events and retry ambiguous failures; never report a refund as complete solely because a request was sent or a ledger row was inserted. Do not call Stripe for a cash/external-card refund.
- Only after those checks, expose localized staff controls and customer policy text. Include explicit pending, succeeded, failed, and manual-refund states; do not promise an automatic refund when one cannot be verified.

This audit does not change live payment behavior. GLOW-24 remains open until the owner decisions, migration, authorization tests, provider reconciliation, deployed UI, and production verification are complete.

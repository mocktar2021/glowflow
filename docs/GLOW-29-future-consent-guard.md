# GLOW-29 future-dated consent guard

This is a draft-code candidate, not permission to apply SQL or enable messaging.
No worker, provider, cron job, or customer message is enabled by the migration.

## Rule

The consent recording API accepts source timestamps up to five minutes ahead of
database time to tolerate clock skew. For notification scheduling, claim
eligibility, and staff-visible status, a future `consented` event is retained
in the audit history but is not effective until database time reaches its
`occurred_at`. A future `opted_out` event takes effect immediately. Eligible
events retain the existing latest-first ordering by `occurred_at`,
`created_at`, and `id`. Compare against database `now()`, never a caller-supplied
claim time. A missing effective consent must return `FALSE`, not SQL `NULL`,
because `claim_notification_delivery` uses PL/pgSQL `IF NOT eligible THEN` and
that branch does not execute for `NULL`.

This is intentionally conservative if timestamps disagree. A future opt-out
blocks a current opt-in until another later effective consent is recorded.
At the time of this GLOW-29 migration, `claim_notification_delivery` returns an
existing claim ID for a repeated idempotency key before running fresh eligibility
checks. Therefore a successful return, especially a retry, is not permission to
send. An eventual delivery worker must recheck effective consent and appointment
state immediately before any send; claim-time protection alone cannot guard
against a later opt-out. This migration does not change the replay contract.
The separate GLOW-27 claim-hardening candidate must review and test a replay
guard before any worker is activated; see `GLOW-27-reminder-scheduling.md`.

## Verification and rollout gate

`tests/reminder-scheduling-database.test.mjs` uses synthetic clients and an
isolated loopback PostgreSQL database. It proves unknown consent and a future
opt-in cannot authorize a due trusted outbox claim, future opt-out suppresses
both eligibility and a revised automatic schedule even when a later-dated
future opt-in exists, and the staff read model shows the effective status.
The database security runner now executes this suite, including the safe
operational rollback, for pull requests and master pushes.

The owner-approved predecessor
`20261018000135_schedule_confirmed_appointment_notifications` was applied
to hosted GlowFlow project `rfwhqutkiztxkagbhevp` on 2026-11-01. Its
postflight showed the scheduler function and trigger present, the 36/36
migration ledger aligned, and no outbox or delivery-attempt rows. This
historical result is not a substitute for a fresh hosted preflight.

Before applying this GLOW-29 migration, confirm exact project identity,
migration order, predecessor function and trigger fingerprints, relevant RLS
and function privileges, and current delivery-worker state. Apply any earlier
missing migration, including the GLOW-9 staff guard `20261019035718`, under
its own separate approval before `20261101172437`. Obtain separate owner
approval for this hosted SQL. Do not use `db push` or infer SQL approval
from a code merge. Keep messaging disabled until the wider GLOW-29 consent
policy and worker pre-send check are complete.
The migration itself also aborts unless the predecessor scheduler function and
trigger exist, preventing `CREATE OR REPLACE` from silently creating that
function on a project missing the preceding migration. This is a second guard,
not a substitute for ledger and fingerprint preflight.

If rollout must stop, use the guarded operational rollback
`supabase/rollbacks/20261101172437_disable_notification_claims_and_scheduling.sql`
under a separate approved plan. It revokes the trusted claim entry point and
removes automatic enqueue, preserving immutable consent/outbox/attempt history
and the corrected functions. It deliberately does **not** restore the older
unsafe eligibility behavior. Re-enabling requires a later reviewed forward
change. There is no data backfill.

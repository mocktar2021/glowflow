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
`claim_notification_delivery` deliberately returns an existing claim ID for a
repeated idempotency key before running fresh eligibility checks. Therefore a
successful return, especially a retry, is not permission to send. An eventual
delivery worker must recheck effective consent and appointment state immediately
before any send; claim-time protection alone cannot guard against a later
opt-out. Changing the existing claim replay contract requires a separate
worker-level design and test, not an unreviewed change in this migration.

## Verification and rollout gate

`tests/reminder-scheduling-database.test.mjs` uses synthetic clients and an
isolated loopback PostgreSQL database. It proves unknown consent and a future
opt-in cannot authorize a due trusted outbox claim, future opt-out suppresses
both eligibility and a revised automatic schedule even when a later-dated
future opt-in exists, and the staff read model shows the effective status.
The database security runner now executes this suite, including the safe
operational rollback, for pull requests and master pushes.

Before any hosted SQL, reconcile the pre-existing GlowFlow migration-ledger
gap: as of 2026-11-01 17:16 UTC, hosted project
`rfwhqutkiztxkagbhevp` listed 35 versions while the repository listed 36;
`20261018000135_schedule_confirmed_appointment_notifications` was local-only.
That ledger difference does not prove schema drift. Capture schema fingerprints
and authorization evidence, review the exact migration order, and obtain
separate owner approval for any hosted database change. Do not use `db push`
or infer approval from a code merge. Keep messaging disabled until the wider
GLOW-29 consent policy and worker pre-send check are complete.
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

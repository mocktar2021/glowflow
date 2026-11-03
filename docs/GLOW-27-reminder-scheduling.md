# GLOW-27: consented email schedule persistence

This slice records confirmation and future 24-hour and 2-hour reminder jobs in the existing append-only outbox. It does not send a message, install a worker or cron job, call a provider, or charge anything. The scheduler migration is present on hosted GlowFlow as of 2026-11-03. It enables outbox persistence, not message delivery.

## Behavior

The `public.appointments` trigger runs in the same transaction as insertion or a real start-time/status revision. A confirmed appointment with a nonblank client email and a latest explicit `email:consented` event gets a confirmation entry and any reminder entries whose scheduled times are still in the future. A canceled appointment, unknown consent, opt-out, or missing email creates no new entries. A later consent event does not retroactively schedule a prior booking; a subsequent appointment revision can schedule it. SMS and WhatsApp are not automatic channels.

The existing generation bump invalidates pending entries when start time or status changes. History is preserved for audit. The request key is the UUID form of `md5('glowflow:g27:email:' || appointment_id || ':' || generation)` and is stable across retries. The pre-existing service-role `schedule_appointment_notifications` RPC remains available, but manual callers replaying an automatically scheduled revision must use this key. The RPC intentionally rejects a different key for the same revision. The trigger does not change its semantics or silently replace its entries.

The trigger is an internal `SECURITY DEFINER` function with an empty search path, table/operation guard, and no direct execute grant for public, anonymous, authenticated, or service roles. The existing appointment mutation path remains the authorization boundary. Existing outbox row-level security and delivery-eligibility checks remain in force.

## Review and rollout

- Migration: `supabase/migrations/20261018000135_schedule_confirmed_appointment_notifications.sql`
- Normalized SHA-256: `3781a6771051c5131ad4ceb3592a00dbb2e36a10ae27efe30ef72470aa63692f`
- Hosted target: Supabase organization `goutxcrujaxjjssbjfsn`, GlowFlow project `rfwhqutkiztxkagbhevp` only. The migration was separately approved and is recorded there. MowFlow was not touched.
- Read-only verification on 2026-11-03: project identity matched, the hosted migration ledger contained `20261018000135`, the private scheduler function and enabled appointment trigger were present, and outbox and delivery-attempt counts were zero. Recheck identity, ledger, fingerprints, privileges, and worker state before any future hosted change; a code merge never authorizes further SQL.
- Rollback: `supabase/rollbacks/20261018000135_stop_confirmed_appointment_email.sql` drops only this trigger and function. It stops future automatic enqueueing; it does not erase appointments, consent, outbox, or attempts. Previously queued entries retain the existing eligibility rules. A separate operational decision would be needed to suppress their delivery.
- Operational risk: database writes to confirmed appointments now depend on outbox scheduling succeeding. This makes booking and scheduling atomic, but an unexpected outbox failure can reject the booking transaction. Continue monitoring confirmed-booking writes. No provider, delivery worker, cron job, or send was enabled by this migration.

## Local verification

Run `tests/reminder-scheduling-database.test.mjs` only against an empty, disposable local PostgreSQL database named `glowflow_reminder_test...` using `GLOWFLOW_REMINDER_SCHEDULING_TEST_DATABASE_URL` and optionally `PSQL_BIN`. The test applies the local fixture, baseline, and all migrations, then verifies consent/contact gates, timing, no-op idempotency, opt-out, reschedule, cancellation, tenant isolation, transactional rollback, and operational rollback. It cannot run against a hosted project because its database name and loopback-host guards reject that target.

Full GLOW-27 acceptance remains open: no real confirmation or reminder delivery is implemented, no provider/worker or preview end-to-end evidence exists, and the policy for transactional booking messages without marketing-style opt-in remains a product/legal decision. Keep GLOW-27 In Progress until those decisions and delivery checks are complete.

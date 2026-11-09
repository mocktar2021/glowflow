# GLOW-56 database-local cleanup proposal (not activated)

This is a code-only design for a no-GitHub-service-role-key alternative to
the dormant [GitHub cleanup schedule](GLOW-56-no-pay-QA-cleanup-schedule-draft.md).
The owner confirmed on November 9, 2026 that there is no separate GitHub PR
reviewer. Do not place a full GlowFlow Supabase service-role key in the
unattended GitHub workflow or set its repository schedule ACK. This proposal
does not install an extension, create a cron job or Vault secret, apply SQL,
seed policy, activate booking v2, or change a hosted setting.

The candidate target is **not isolated QA**. Supabase organization
`goutxcrujaxjjssbjfsn`, project `rfwhqutkiztxkagbhevp`, currently backs
`glowflow.mocktar.com` and generic Preview. Scheduling cleanup there would
mutate a shared live development backend. Never target MowFlow or assume that
the future `glowflow.beauty` production project has the same state.

## Candidate execution contract

Use two independent database-local `pg_cron` jobs, one for
`public.sweep_public_booking_intents(100)` and one for
`public.sweep_public_booking_quota_counters(1000)`, each every minute in the
candidate design. Their proposed exact names are
`glowflow_qa_booking_intent_sweep_v1` and
`glowflow_qa_booking_quota_sweep_v1`. The calls use the existing bounded
functions; the installed gate migration makes the intent sweep `SECURITY
DEFINER`, while the quota sweep remains `SECURITY INVOKER`. Preserve their
fixed search paths and restricted `EXECUTE` grants, and verify the proposed
cron execution role can call both without granting them to `anon` or
`authenticated`. No HTTP endpoint or application service-role key is needed
to run the sweeps. The exact scheduling SQL, execution role,
timeouts, permissions, and installation migration need their own reviewed
proposal and disposable-PostgreSQL proof. Do not copy this paragraph into a
SQL editor as an activation instruction.

Each invocation must commit its bounded progress. A partial pass is not a
failure to roll back: its full-sweep heartbeat remains unset until that sweep
actually reaches `complete = true`. Do not put repeated sweeps in one long
transaction or raise after a partial pass; either can roll back useful PII
scrubbing and expired-counter deletion. A `busy` result or a successful cron
job record is **not** evidence of a complete sweep. The two cleanup functions
use different advisory locks, so neither job should infer the other's health.
Measure actual backlog drain time under disposable load before choosing the
cadence and per-call limits. Never accept a schedule merely because one empty
database run succeeds. Supabase currently recommends no more than eight
concurrent Cron jobs and no job longer than 10 minutes; these proposed
minute-level jobs also need a measured runtime comfortably below one minute
so their own runs do not accumulate.

The database's existing new-admission fence requires fresh *complete* intent
and quota sweeps within two hours. Keep that fail-closed behavior. The job
must not make a stale, partial, busy, failed, or skipped sweep look fresh;
never manually stamp a heartbeat to bypass cleanup. Existing-intent recovery
and rollback modes have separate contracts in the
[QA/cutover runbook](GLOW-56-no-pay-qa-and-cutover-readiness.md).

## Independent detection, not cron-status optimism

The candidate alert design uses a separate `pg_cron` monitor job named
`glowflow_qa_booking_cleanup_monitor_v1` at minutes 17 and 47. It checks
that **both** `last_full_sweep_at` timestamps are non-null, not in the
future, and within the last 10 minutes. Only then may it queue one success
signal to an independent Healthchecks.io check. A partial sweep clears its
own heartbeat. A `busy` return is never itself evidence of health, but it
leaves a prior complete heartbeat unchanged: a transient busy call can
therefore be followed by a ping while both earlier full sweeps are still
fresh. Persistent contention stops pings when freshness expires. This
monitor detects recently completed sweeps, not every transient lock wait.

The Healthchecks URL is a bearer secret. Store it in Supabase Vault, not in
`cron.job.command`, source control, SQL logs, or response bodies. `pg_net`
is asynchronous: a returned request ID proves only enqueueing; its HTTP
request starts after the database transaction commits. At activation,
inspect the actual response and confirm the event appears in the intended
Healthchecks check. Neither a sweep or monitor job marked `succeeded` nor
an enqueued request is proof of alert delivery. Avoid promising an explicit
failure ping from a transaction that rethrows, because rollback can discard
the queued request.

A candidate check period of 60 minutes plus 15 minutes of grace should
surface a missed monitor ping roughly 75 minutes after the last successful
ping. A stopped sweep can leave a still-fresh heartbeat for up to 10 minutes,
so detection can extend to roughly 85 minutes after a sweep stops, leaving
about 35 minutes before the two-hour database fence. This is not a delivery
guarantee. Test missed pings, failed SQL, partial backlog, busy locks,
`pg_net` failure, provider failure, and absent schedules with real alerts
before v2. Route alerts to the monitored primary
`glowflow@mocktar.com` and distinct backup
`mocktartechnologies.africa@gmail.com`; confirm named human responders,
acknowledgment, escalation, and a real alert received by both.
`cron.job_run_details` is useful for diagnosis but is not an independent
missed-run alert. Two minute-level sweep jobs plus one half-hour monitor
would create about 2,928 run-history rows per day (2 x 1,440 + 48). Review
bounded retention for **only** the exact three GlowFlow job IDs and prove
that it cannot delete another job's history. No retention deletion is
currently active or approved; verify provider defaults and storage impact
before activation.

Installing `pg_cron` alone is not enough. The alert design may also require
separately reviewed `pg_net` and Vault configuration. A prior read-only check
found `pg_cron` available but not installed; recheck every extension and
privilege on the exact project before approval. Do not rely on a stale check
or on presumed free-tier capacity.

## Staged approval and preflight

1. Review the exact code-only migration and test evidence. In a disposable
   local Postgres environment, prove role restrictions; bounded partial
   progress; busy, error, and timeout handling; no false success signal;
   repeated full sweeps; a monitor refusing stale or missing heartbeats;
   missing Vault secret; and no anon/authenticated access to private cleanup
   state. Include realistic backlog sizes and
   cross-tenant fixtures. No live booking, payment, or notification is a
   substitute for those tests.
2. Before *each* hosted change, freshly verify GlowFlow organization and
   project identity, the exact migration ledger and source hash, schema and
   function fingerprints, RLS/grants, gate mode, existing intent/quota policy
   and cleanup state, extension versions/ownership, existing `cron.job` names
   and commands, Vault/`pg_net` availability, and security/health advisories.
   Stop on any unexplained difference or conflicting job. Do not run bulk
   `db push` or install into another project.
3. Obtain explicit approval for the exact hosted extension/migration SQL,
   matching history entry, Vault secret creation, job activation, and alert
   configuration. A code merge is not that approval. Never place a
   Healthchecks URL or database key in the approval record or logs.
4. Activate only the three reviewed jobs, with booking v2 still off. Prove
   bounded partial passes eventually produce two fresh full-sweep heartbeats;
   inspect `cron.job_run_details`, the `pg_net` response, and actual
   Healthchecks success and missed-ping delivery to both responders. Stop if
   backlog does not drain comfortably within the two-hour fence or if any
   signal is ambiguous.
5. Only then consider separately approved quota/intent policy, gate
   transition, application flag, and owner booking acceptance. Keep GLOW-56
   In Progress until the end-to-end hosted journey and rollback are verified.

## Disable and recovery

If a job is unsafe, stop new booking-v2 preparations using the reviewed
contract-gate procedure and preserve existing-intent recovery. Unschedule
**only** the exact GlowFlow job names after verifying their IDs and commands;
wait for any in-flight invocation to finish and confirm no new runs. Never
`DROP EXTENSION pg_cron` as routine rollback: that can delete unrelated jobs.
Do not clear policies, cleanup state, intent tombstones, or heartbeats just to
make health checks green. If v2 has ever opened, do not return to the legacy
booking path; use the reviewed `v2_no_prepares` recovery-only mode. Every
hosted disable or rollback requires its own scoped approval and fresh checks.

References: [Supabase Cron](https://supabase.com/docs/guides/cron),
[Cron installation warning](https://supabase.com/docs/guides/cron/install),
[pg_net asynchronous request behavior](https://supabase.com/docs/guides/database/extensions/pg_net),
the existing GLOW-56 migration-defined sweep functions, and the
[hosted gate evidence](GLOW-56-gate-hosted-smoke-plan.md). Provider behavior
and plan limits must be rechecked at activation.

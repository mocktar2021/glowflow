# GLOW-56 database-local cleanup proposal (not activated)

This is a code-only design for a no-GitHub-service-role-key alternative to
the dormant [GitHub cleanup schedule](GLOW-56-no-pay-QA-cleanup-schedule-draft.md).
The owner confirmed on November 9, 2026 that there is no separate GitHub PR
reviewer. Do not place a full GlowFlow Supabase service-role key in the
unattended GitHub workflow or set its repository schedule ACK. Merging a
code-only migration or this runbook does not apply SQL, install an extension,
create a cron job or Vault secret, seed policy, activate booking v2, or change
a hosted setting. Each hosted step needs its own exact approval.

The candidate target is **not isolated QA**. Supabase organization
`goutxcrujaxjjssbjfsn`, project `rfwhqutkiztxkagbhevp`, currently backs
`glowflow.mocktar.com` and generic Preview. Scheduling cleanup there would
mutate a shared live development backend. Never target MowFlow or assume that
the future `glowflow.beauty` production project has the same state.

The current first-stage, code-only migration is
`20261109162926_glow56_cleanup_monitor_ready.sql`. It defines only the private,
zero-argument `glow56_cleanup_monitor_ready()` boolean helper: one clock
snapshot, two non-null full-sweep heartbeats, neither in the future, both less
than 10 minutes old. It is `SECURITY INVOKER` with an empty search path and
execution restricted to `postgres`. It does **not** install `pg_cron` or
`pg_net`, read a Vault secret, create any job, send a ping, or run cleanup.
It is not evidence that a hosted scheduler or failure alert is ready. The
dedicated disposable PostgreSQL 17 fixture now checks the candidate inactive
jobs and restricted Cron permissions, but hosted identity, cost, backlog,
alert delivery, and separately approved application remain open.

The exact candidate inactive-stage and scoped unstage SQL now live in
[`ops/glow56-stage-inactive-cron.psql`](../ops/glow56-stage-inactive-cron.psql)
and [`ops/glow56-unstage-inactive-cron.psql`](../ops/glow56-unstage-inactive-cron.psql).
They are operator-review artifacts outside the normal migration chain, not
hosted instructions or approval. The dedicated disposable PostgreSQL 17 CI
fixture runs those same files. See the
[operator artifact gate](GLOW-56-inactive-cron-operator-artifact.md) before
proposing any hosted step.

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
to run the sweeps. The exact scheduling SQL, execution role, and timeouts
now have disposable PostgreSQL 17 coverage; hosted permissions, cost, and
installation still need separate approval. Do not copy this paragraph into
a SQL editor as an activation instruction.

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
At the proposed limits, one-minute runs have theoretical ceilings of 6,000
intent items and 60,000 quota counter items processed per hour, not a
throughput guarantee or a bound on every SQL row touched.

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
future, and within the last 10 minutes. The currently staged command returns
only a boolean and sends **no** success signal. A later separately reviewed
alert path may queue a Healthchecks signal only when the predicate is true.
A partial sweep clears its
own heartbeat. A `busy` return is never itself evidence of health, but it
leaves a prior complete heartbeat unchanged: a transient busy call can
therefore be followed by a ping while both earlier full sweeps are still
fresh. Persistent contention stops pings when freshness expires. This
monitor detects recently completed sweeps, not every transient lock wait.

The Healthchecks URL is a bearer secret. The candidate monitor looks it up
at runtime by the fixed Vault name `glowflow_qa_booking_cleanup_ping_v1`;
neither the URL nor its UUID may appear in `cron.job.command`, source control,
SQL logs, or response bodies. A private, restricted monitor helper should
return only non-secret status and reject a missing or malformed URL without
printing it. Review access to `vault.decrypted_secrets`, the `pg_net` request
queue, and Cron logs because the queued request may briefly contain the URL.
The tagged `pg_net` 0.20.4 SQL grants PUBLIC access to its queue and response
tables by default. Do not enqueue the bearer URL until the exact installed
table grants have been inspected, restricted, and tested for `anon`,
`authenticated`, and `service_role` as well as the intended execution role.
`pg_net` is asynchronous: a returned request ID proves only enqueueing; its HTTP
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
separately reviewed `pg_net` and Vault configuration. A November 9 read-only
check of the exact GlowFlow project found `pg_cron` 1.6.4 and `pg_net` 0.20.4
available but not installed, while Vault 0.3.1 was installed. Recheck every
extension and privilege on the exact project before approval. A November 9
read-only organization check reported `tier_pro`, not Free; that says nothing
about incremental Cron, `pg_net`, or database-compute charges. The owner's
no-new-payment limit still applies. Verify actual plan terms, project usage,
disk headroom, and no incremental cost before any hosted installation or
activation; do not upgrade, purchase, or change billing. Do not rely on
either dated check.

## Staged approval and preflight

1. Review the first-stage helper migration and disposable tests of fresh,
   stale, missing, and future heartbeats, plus role restrictions. Before any
   later inactive-job or ping migration, prove bounded partial progress;
   busy, error, and timeout handling; no false success signal; repeated full
   sweeps; a monitor refusing stale or missing heartbeats; missing Vault
   secret; and no anon/authenticated access to private cleanup state. Include
   realistic backlog sizes and cross-tenant fixtures. No live booking,
   payment, or notification is a substitute for those tests.
2. Before *each* hosted change, freshly verify GlowFlow organization and
   project identity, the exact migration ledger and source hash, schema and
   function fingerprints, RLS/grants, gate mode, existing intent/quota policy
   and cleanup state, extension versions/ownership, existing `cron.job` names
   and commands, Vault/`pg_net` availability, and security/health advisories.
   Record each existing Cron job's ID, name, schedule, command, database,
   username, and active state; if `pg_cron` is absent, record that the catalog
   is unavailable rather than assuming it is empty. `cron.schedule` can
   overwrite an existing same-name job, so stop on any unexplained difference
   or conflicting job. Do not run bulk
   `db push` or install into another project.
3. Obtain explicit approval for the exact hosted first-stage helper SQL and
   matching history entry. A code merge is not that approval. The helper
   migration installs no extension or job; verify its definition, owner,
   search path, and restricted `EXECUTE` grants after any approved application.
4. Obtain a **separate** approval for any later extension and inactive-job
   migration. Stage jobs inactive only if an extension-capable disposable test
   proves creation and deactivation are atomic on matching versions; otherwise
   do not create jobs. After an approved inactive install, verify the three exact
   names, IDs, commands, schedules, database, username, and `active = false`.
   Wait past a scheduled interval and verify those IDs have no run history;
   if anything ran, stop and use the scoped disable procedure below. Verify
   booking v2 and the GitHub schedule remain off.
5. Obtain separate explicit approval for Vault secret creation, job
   activation, and alert configuration. Enter the Healthchecks bearer URL
   through the Supabase Vault Dashboard UI under its fixed name, not as a
   literal in a migration, SQL Editor query, terminal command, chat, or log.
   Verify presence by name/ID and access controls without selecting or
   displaying `decrypted_secret`; never put the URL or database key in an
   approval record. If secret-safe entry or least-privilege access cannot be
   verified, stop before activation.
6. Activate only the three reviewed jobs, with booking v2 still off. Prove
   bounded partial passes eventually produce two fresh full-sweep heartbeats;
   inspect `cron.job_run_details`, the `pg_net` response, and actual
   Healthchecks success and missed-ping delivery to both responders. Stop if
   backlog does not drain comfortably within the two-hour fence or if any
   signal is ambiguous.
7. Only then consider separately approved quota/intent policy, gate
   transition, application flag, and owner booking acceptance. Keep GLOW-56
   In Progress until the end-to-end hosted journey and rollback are verified.

## Disable and recovery

If a job is unsafe, stop new booking-v2 preparations using the reviewed
contract-gate procedure and preserve existing-intent recovery. Unschedule
**only** the three exact GlowFlow jobs after matching each ID to its approved
name, command, database, and username. First deactivate those IDs, wait for
any in-flight invocation to finish, then unschedule by the supported ID or
verified name and confirm those IDs have no new runs. Do not delete another
job or its run history. Never
`DROP EXTENSION pg_cron` as routine rollback: that can delete unrelated jobs.
Do not clear policies, cleanup state, intent tombstones, or heartbeats just to
make health checks green. If v2 has ever opened, do not return to the legacy
booking path; use the reviewed `v2_no_prepares` recovery-only mode. Every
hosted disable or rollback requires its own scoped approval and fresh checks.

References: [Supabase Cron](https://supabase.com/docs/guides/cron),
[Cron job lifecycle](https://supabase.com/docs/guides/cron/quickstart),
[Cron installation warning](https://supabase.com/docs/guides/cron/install),
[pg_net asynchronous request behavior](https://supabase.com/docs/guides/database/extensions/pg_net),
[pg_net 0.20.4 default grants](https://github.com/supabase/pg_net/blob/v0.20.4/sql/pg_net.sql),
[Vault UI and secret guidance](https://supabase.com/docs/guides/database/vault),
the existing GLOW-56 migration-defined sweep functions, and the
[hosted gate evidence](GLOW-56-gate-hosted-smoke-plan.md). Provider behavior
and plan limits must be rechecked at activation.
The Supabase CLI was unavailable during the prior design-only PR, so it did
not invent a migration filename. Any new migration must be generated with the
official CLI. Direct access to the Supabase changelog index was blocked;
recheck current release notes before hosted implementation.

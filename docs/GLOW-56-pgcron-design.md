# GLOW-56 database-local cleanup design (proposal only)

This note proposes a no-GitHub-service-role-key alternative for the shared
GlowFlow sandbox at `rfwhqutkiztxkagbhevp`. It is **not an activation plan or
an executable migration**. No job, extension, secret, hosted policy, or booking
v2 flag is installed by this document. The project backs
`glowflow.mocktar.com`, so any later activation is a live/shared-backend change
requiring its own owner approval and exact preflight.

## Execution contract

Use two separately named, one-call Supabase Cron jobs, each running once per
minute in UTC:

| Proposed job name | One command per invocation | Maximum batch candidates |
| --- | --- | ---: |
| `glowflow_qa_booking_intent_sweep_v1` | `select public.sweep_public_booking_intents(100);` | 100 |
| `glowflow_qa_booking_quota_sweep_v1` | `select public.sweep_public_booking_quota_counters(1000);` | 1,000 |

Each invocation must be its own committed transaction. A partial pass commits
its bounded scrub/deletion work and leaves its full-sweep heartbeat unset;
the next minute can continue. Both existing functions have advisory-lock and
bounded-batch behavior. Do **not** loop many sweeps in one `DO` block or
function called by one Cron job: a later error or timeout rolls back earlier
passes, including privacy scrubs. One-minute cadence offers theoretical
ceilings of 6,000 intent rows and 60,000 quota rows per hour, not a throughput
guarantee. Measure actual due backlog and worst-case runtime before activation.
If either full-sweep heartbeat is stale, the existing v2 gate must keep new
preparations closed; never treat a Cron run status of `succeeded` or a JSON
`complete: false` result as proof of a full sweep.

The current contract-gate migration changes the intent sweep to `SECURITY
DEFINER`; the quota sweep remains `SECURITY INVOKER`. Their migrations revoke
execution from `PUBLIC`, `anon`, and `authenticated` and grant it to
`service_role`. The proposed jobs would be created and run as database role
`postgres`, without an HTTP service-role key. Before any hosted installation,
prove against a disposable Postgres database and the fresh hosted catalog
that the proposed job owner can execute both exact functions and access the
private tables. Do not broaden `anon` or `authenticated` grants or change
either function's security mode to make Cron work. Preserve the intent sweep's
existing empty `search_path` and restricted `EXECUTE` grants.

## Health signal and independent alert

A separate proposed job, `glowflow_qa_booking_cleanup_monitor_v1`, would run
at minutes 17 and 47. It must emit **one** Healthchecks success ping only if
both private `last_full_sweep_at` values are non-null, no later than the same
`clock_timestamp()`, and less than 10 minutes old. A partial pass clears its
marker, so it cannot satisfy this test. A transient `busy` result can leave a
recent prior full-sweep marker in place; the monitor reports freshness, not
the success of every invocation. Persistent busy eventually stops pings. The
ping URL is a bearer credential and belongs in Supabase Vault, not in a Cron
command, repository, logs, or a GitHub Action. A separately reviewed `pg_net`
request may queue the ping after the freshness check; queuing is not evidence
of delivery. Verify actual receipt, failure behavior, and missed-ping alerts
to the primary and backup inboxes before enabling v2. An independent
Healthchecks missed-ping alert is needed because Cron cannot report a job that
never started. The database freshness fence remains authoritative and fails
closed if monitoring or cleanup stops.

## Staged approval and rollback boundaries

1. Fresh preflight must match the GlowFlow organization/project identity,
   migration ledger and function fingerprints, extension availability and
   versions, current Cron catalog, v2 gate state, and measured due-row counts.
   `pg_cron` and `pg_net` availability is not evidence that either is installed.
2. Review a separately generated, versioned migration and disposable-DB tests
   before asking for **separate explicit approval** to install extensions or
   inactive jobs on the shared hosted project. The Supabase CLI was unavailable
   in this workspace when this note was written, so no migration filename is
   invented here. Applying a migration is not authorized by merging this note.
3. Verify unique job names before scheduling: Supabase Cron replaces an
   existing same-case name. Treat any collision or unexpected existing job as
   a stop condition. Stage all three jobs inactive only after proving that
   creation and deactivation are atomic on the target version; otherwise keep
   scheduling out of the first migration. Separately verify role access,
   bounded progress, full-sweep freshness, and real alert delivery before
   requesting approval to activate jobs and v2.
4. On rollback, disable or unschedule only the exact three GlowFlow job IDs
   after verifying their names and commands. Do not drop `pg_cron`: that would
   delete unrelated jobs. Keep v2 off, or fail it closed, until an approved
   cleanup path is healthy again.

`cron.job_run_details` is not automatically pruned and remains after a job is
unscheduled. Two one-minute sweep jobs produce up to 2,880 run records per
day, before the monitor job. Approve a bounded, job-ID-scoped history retention
procedure and verify disk headroom before activation; never truncate shared
Cron history. Runtime and storage costs on the free project must be checked,
not assumed.

Current references: [Supabase Cron](https://supabase.com/docs/guides/cron),
[install](https://supabase.com/docs/guides/cron/install), and
[quickstart](https://supabase.com/docs/guides/cron/quickstart). The documentation
search was available, but direct access to the changelog index failed from
this workspace. Recheck release notes and current docs before implementation.

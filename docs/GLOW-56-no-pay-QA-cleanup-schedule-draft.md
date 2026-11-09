# GLOW-56 no-pay shared-backend cleanup schedule (dormant)

The owner confirmed on November 9, 2026 that there is no separate GitHub
reviewer for this repository. The protected-`master` review prerequisite
below therefore cannot currently be met. Keep this GitHub schedule dormant,
do not add a full Supabase service-role key or repository ACK, and review the
code-only [database-local cleanup alternative](GLOW-56-database-local-cleanup-proposal.md)
instead. This does not authorize installing `pg_cron` or activating v2.

This is code only. [PR #224](https://github.com/mocktar2021/glowflow/pull/224)
merged as `e53701510030db033155190b759858ad2b0f9d60` on November 5, 2026.
The GitHub Actions cleanup job is deliberately skipped
unless the **repository Actions variable** `GLOWFLOW_QA_CLEANUP_SCHEDULE_ACK` is exactly
`enable-glow56-qa-cleanup-20261105`.
At code merge, the owner's GitHub Settings screenshot showed no repository
Actions variables; it did not show the dedicated cleanup Environment. A later
owner screenshot showed a `glowflow-qa-booking-cleanup` Environment limited to
`master`, with required reviewers and wait timer off and no Environment
secrets or variables. The owner subsequently reported turning administrator
bypass off. These are dated, owner-provided observations, not independent
verification of the current settings. This connected workspace cannot read
GitHub Actions variables or Environment protection settings. There is no manual-dispatch
trigger. The job remains skipped while the repository opt-in is absent.
Before any activation, recheck the repository variable, branch restriction,
bypass control, and Environment secret state. A code merge
alone does not apply SQL, seed a policy, turn on v2, deploy a scheduler to
Vercel, send a Healthchecks ping, or contact a customer. Do not set the
variable until the steps below are separately reviewed and approved.

**This target is not isolated QA.** The fixed Supabase project
`rfwhqutkiztxkagbhevp` backs the current live
`glowflow.mocktar.com` site; generic Preview deployments share it. If
activated, the schedule would mutate that live/shared GlowFlow sandbox
backend. Activation therefore needs separate approval for a live-backend
operation, or a verified isolated backend plus a reviewed target change.
Neither condition was met at code merge. This workflow cannot be cited as
isolated-QA operational evidence.

## Candidate operation

The opt-in must be set at **repository** scope if activation is separately
approved. The workflow checks `vars.GLOWFLOW_QA_CLEANUP_SCHEDULE_ACK` in its
job-level `if`, which GitHub evaluates before the job starts; Environment
variables are not available until the job starts. An Environment variable of
the same name cannot enable this job. Keep the service-role key and Healthchecks
ping URL as protected Environment **secrets**, not repository variables.

The workflow runs only on `mocktar2021/glowflow` default-branch schedules at
17 and 47 minutes past each hour, with one non-overlapping job, a 10-minute
job timeout, and minimal read-only GitHub permissions. It checks out the
reviewed default branch without persisting Git credentials, sets Node 22,
preflights an exact `https://hc-ping.com/<uuid>` base URL, invokes the
existing project-pinned `ops/booking-v2-cleanup.mjs` with fixed reviewed bounds,
then pings Healthchecks success only after both sweeps report complete. If
the cleanup step fails, a separate `/<uuid>/fail` ping marks the check down;
a timeout/cancel/no-run instead relies on the missed-success alert. The UUID
API may return HTTP 200 even for an unknown or rate-limited check, so the
helper also requires its documented, bounded `OK` response body. A missing,
malformed, redirected, rejected, or timed-out signal fails the workflow and
never reports success. Activation must also confirm the event appears in the
intended Healthchecks check. Signals send no body or booking data. Errors
never print the ping URL or the service-role key. The two secrets belong in a dedicated
`glowflow-qa-booking-cleanup` GitHub Environment restricted to `master`, not
in source code or PR workflows.

The code pins `actions/checkout` v4.2.2 at
`11bd71901bbe5b1630ceea73d27597364c9af683` and `actions/setup-node`
v4.4.0 at `49933ea5288caeca8642d1e84afbd3f7d6820020`; both identities
were checked against the corresponding official Git tags before code merge.
The fixed runner bounds are 25 calls per sweep, 60 seconds total, 100 intent
rows and 1,000 quota rows per call. These are upper bounds, not proof the
actual shared-backend backlog drains on time. No runner should refresh a full-sweep
heartbeat until its own sweep is complete.

## Independent failure detection and responders

Configure a separate free Healthchecks.io check to expect successful pings
within 60 minutes with 15 minutes of grace. A cleanup-step failure explicitly
marks the check down through the failure endpoint. If a schedule does not run,
times out, or cannot reach Healthchecks, missed-success detection aims to alert
by 75 minutes after the last complete run, leaving about 45 minutes before
the database's two-hour freshness fence.
GitHub schedules are best effort and can be delayed or dropped; a workflow
run by itself cannot detect that it never started. The database must continue
to fail closed if both full-sweep heartbeats become stale. Configure GitHub
workflow-failure notifications too. Validate the chosen Healthchecks check's
failure-alert and missed-ping behavior on the free plan; neither is guaranteed
to deliver before the database fence.

The owner identified monitored `glowflow@mocktar.com` as the primary alert
inbox and monitored `mocktartechnologies.africa@gmail.com` as the distinct
backup inbox. The human primary and backup responders still need to be named
for those inboxes. Both responders must receive a real missed-ping test alert,
acknowledge it, and agree on who investigates and who escalates before the
two-hour deadline. Use a separate credential owner and backup for the GitHub
Environment and Healthchecks account. Keep Healthchecks UUID URLs private:
they are bearer credentials that can falsely mark a check healthy if leaked.

Scheduled cleanup must run unattended every 30 minutes. Do not require a
human reviewer or wait timer on each Environment deployment: either would
hold scheduled jobs and risk breaching the two-hour freshness fence. Instead,
require an enforceable `master` ruleset before it can execute with the
service-role secret: mandatory PR review and required CI/security checks,
no direct or force pushes or branch deletion, and no administrator bypass.
Keep the Environment restricted to `master` with its bypass control off.
With no per-run reviewers, turning off Environment administrator bypass alone
is not an approval gate or a substitute for protected `master`. Independently
verify both sets of current GitHub settings before storing a key or opting in;
the owner's report that Environment bypass was turned off is not verification.
If the required branch rules or Environment restriction cannot be enforced,
do not store the key or opt in.
No secret or repository ACK is authorized by this runbook correction. The
unattended schedule also requires tested Healthchecks failure and missed-ping
alerts with named responders before activation.

Before opt-in, verify the existing shared GlowFlow project identity and migration
ledger, apply only separately approved hosted migrations, approve quota and
intent policy, prove cleanup can drain the expected backlog within the fixed
limits, and test missing secrets, forced sweep failure, missed schedule,
failed/redirected success and failure pings, real alert delivery, and fail-closed booking
behavior. Review GitHub Actions and Healthchecks free-plan limits and account
status at activation. Establish secure secret custody before adding a
service-role key. Read-only GitHub token permissions do not constrain
what code with that service-role secret can do to Supabase. A public GitHub
repository's standard hosted runner is currently free, and Healthchecks'
free Hobbyist plan currently offers 20
checks; neither provides a hard pre-deadline delivery guarantee. Vercel Hobby
Cron is not a substitute because it currently allows only one invocation per
day. The current shared sandbox is not the future `glowflow.beauty` production
environment, but it is live and should be treated as such.

References: [GitHub configuration-variable availability](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables),
[GitHub schedule limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
[GitHub public-runner pricing](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job),
[Healthchecks ping API](https://healthchecks.io/docs/http_api/),
[Healthchecks free tier](https://healthchecks.io/pricing/),
[Vercel Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

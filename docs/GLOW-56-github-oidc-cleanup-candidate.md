# GLOW-56 no-key GitHub cleanup candidate (inactive)

November 14 update: the owner-provided Vercel screenshot shows the existing
team on Pro, not Hobby. GitHub's observed scheduled-run gaps make this
candidate unsuitable for the two-hour freshness target. A separately gated,
inactive [Vercel Pro adapter](GLOW-56-vercel-pro-cleanup-candidate.md) is now
under review. Do not set this workflow's ACK while evaluating that adapter.

This is a **code-only, inactive** alternative to the earlier GitHub
service-role-key draft and the database-local `pg_cron`/`pg_net` proposal.
Neither approach was activated on hosted GlowFlow. The existing bounded
`ops/booking-v2-cleanup.mjs` logic and redirect-rejecting
`ops/booking-v2-healthcheck.mjs` are reused in a protected Vercel Function.
No migration, extension, Vault secret, database job, booking-v2 flag, or
Healthchecks signal is installed or sent by merging this candidate.

The target is the **shared development backend**, not isolated QA or the
future `glowflow.beauty` production stack: GitHub `mocktar2021/glowflow`,
Vercel team `team_ObLZOyZ2aT7LLu4cjxQGJPzJ`, project
`prj_YZ96jIX5QEOOI70zUlbHSaIqQbsu`, alias `glowflow.mocktar.com`, and
Supabase project `rfwhqutkiztxkagbhevp` in organization
`goutxcrujaxjjssbjfsn`. Recheck all identities before any hosted change.

## Trust and execution boundary

The schedule at minutes 17 and 47 remains skipped unless repository variable
`GLOWFLOW_QA_CLEANUP_SCHEDULE_ACK` equals the new exact value
`enable-glow56-qa-oidc-cleanup-20261110`. The old ACK value cannot start
this replacement. It has no GitHub Actions secret, database key, or
Healthchecks URL. The job requests a short-lived GitHub OIDC token with a
fixed audience and POSTs it to the exact QA alias. The route verifies the
signature and issuer against GitHub's JWKs, its audience, freshness, repo
and owner IDs, public visibility, exact master ref and subject, exact workflow
file, and `schedule` event. The existing `glowflow-qa-booking-cleanup` GitHub
Environment is intentionally not used by this secretless replacement: its
human-review gate would pause unattended runs. Its settings are unchanged.
An unauthenticated, Preview,
wrong-host, wrong-project, or inactive call returns 404 before accessing a
secret or running a sweep. GitHub Actions schedules can be delayed or
dropped; a successful workflow run is not the independent alert.

The QA Vercel route has a **second, separately configured** Production-only
activation value, `GLOWFLOW_QA_OIDC_CLEANUP_ACTIVE` =
`enable-glow56-qa-oidc-cleanup-20261110`. This variable is not set by the
code. The route requires the existing server-only `SUPABASE_SECRET_KEY`,
the exact QA Supabase URL, and a new server-only
`GLOWFLOW_QA_HEALTHCHECKS_PING_URL`. Do not put either secret in GitHub,
source, chat, a URL query, or public logs. The route executes at most 25
calls for each sweep, with 100 intent and 1,000 quota rows per call and a
45-second combined deadline. It only returns 204 after **both** sweeps
report complete and Healthchecks accepts a redirect-rejecting success ping.
An incomplete/busy/error result sends a failure ping when possible and
returns 503; a failed signal also returns 503. Timeouts, a missing schedule,
or a provider outage leave the success ping absent. No response contains a
secret or customer record.

This design avoids the pinned `pg_net` worker's automatic redirect following
and its queue table containing a bearer URL. It also avoids `pg_cron` run
history. It does **not** prove a zero-cost or reliable hosted operation:
the shared database and Vercel Function still consume included resources.
At two runs per hour this is approximately 48 Function invocations per day,
with up to 50 bounded database RPCs per invocation. Measure actual typical
and worst-case duration, backlog, and usage before activation. The free
Healthchecks Hobbyist plan currently lists 20 checks and 100 log entries per
check; confirm the account's current entitlement and email integrations.
Never upgrade or add paid capacity for this test.

## Separate hosted gates

1. Recheck the exact GitHub default branch, repository variable state,
   confirm the legacy Environment remains unchanged and is not used by this
   new secretless workflow,
   current Vercel alias/deployment and **Pro** usage and remaining credit, Supabase organization,
   project, migration ledger, sweep definitions/grants, policy, cleanup
   backlog, and Vercel server-only credential availability without revealing
   credential values. Stop on any difference. Confirm no active legacy
   GitHub cleanup schedule or database-local Cron jobs.
2. Establish one free Healthchecks check with a 60-minute period and
   15-minute grace, then configure the monitored primary
   `glowflow@mocktar.com` and distinct backup
   `mocktartechnologies.africa@gmail.com`. Confirm named human responders.
   The bearer ping URL belongs only in the Vercel Production environment
   after separate approval. Do not paste it into chat or SQL.
3. Under separate exact approval, set the Vercel Production-only ping secret
   and the route activation value. Keep the GitHub repository ACK **unset**
   and booking v2 off. Verify signed-out/Preview/wrong-host requests cannot
   run cleanup, using only safe read-only probes. Do not send a synthetic
   cleanup POST to the shared backend.
4. Under another exact approval and a staffed window, set the repository ACK.
   Observe the first genuine scheduled run, both complete sweeps, the
   Healthchecks success event, and actual failure/missed-run notifications
   received by both responders. To test a missed run, first establish a
   successful baseline, then temporarily remove the ACK and wait through
   the check's period and grace; restore only under the reviewed plan.
   Booking v2 stays off during this exercise.
5. Validate that backlog drains well inside the existing two-hour database
   freshness fence. If not, leave booking v2 off and revise bounds or
   cadence in code. Only then seek a separate approval for the v2 gate and
   application switch, with a rollback and owner acceptance test.

Stopping or rolling back this schedule means removing only its new repository
ACK and Vercel route activation variable after a fresh scope check, waiting
for any in-flight request, and verifying no later run or success ping. It
does not require dropping any extension or deleting customer data. A paused
schedule does not by itself authorize returning to the legacy booking path
if v2 has ever opened. Keep GLOW-56 In Progress until hosted behavior and
owner acceptance are proven.

References: [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc),
[GitHub schedule limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
[Vercel Function limits](https://vercel.com/docs/functions/configuring-functions/duration),
[Vercel Hobby Cron restriction](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing),
[Healthchecks pricing](https://healthchecks.io/pricing/), and the existing
[booking cutover runbook](GLOW-56-no-pay-qa-and-cutover-readiness.md).

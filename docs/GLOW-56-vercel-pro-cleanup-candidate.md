# GLOW-56 Vercel Pro cleanup adapter (inactive)

The shared GlowFlow development site now has an **inactive** Vercel Cron
adapter at `/api/internal/glow56-vercel-cleanup`. It reuses the existing
bounded database sweeps and Healthchecks signaling. This change does not
register a Vercel Cron or Schedules job, set `CRON_SECRET`, set the new
activation variable, invoke a Function, or change Supabase. The existing
GitHub OIDC workflow remains separately dormant. If both route activation
values are set, both adapters reject before accessing the database key.
Keep the GitHub workflow ACK unset; the code guard is a last-resort fence,
not an activation or a substitute for the operator preflight.

The owner-provided November 14 screenshots show Vercel Pro with $14.58 of
the team's $20 included credit used in the October 23 to November 23 cycle,
and the exact GlowFlow Supabase project `rfwhqutkiztxkagbhevp` healthy on
Pro/Nano. The Vercel figure covers all selected projects, not GlowFlow alone.
The Supabase image does not show monthly usage or overage. Neither screen
establishes that unattended cleanup can run without additional charges.

Vercel Pro permits a 30-minute Cron expression, but every invocation uses
billable Vercel Function capacity. The proposed expression is
`17,47 * * * *`, approximately 48 invocations per day. No configuration
registers it yet. Vercel calls a Cron route with GET and sends the deployed
`CRON_SECRET` as a Bearer token. This adapter requires that secret to be at
least 32 non-whitespace characters and also requires the exact schedule
header, production environment, QA alias and Supabase URL, and the separate
exact activation value `GLOWFLOW_QA_VERCEL_CLEANUP_ACTIVE` =
`enable-glow56-qa-vercel-cleanup-20261114`. Invalid requests return an empty
404 before accessing the database key. It uses the existing server-only
`SUPABASE_SECRET_KEY` and `GLOWFLOW_QA_HEALTHCHECKS_PING_URL` only after
authentication. No secret belongs in source, logs, a query string, or chat.

Before a **separately approved** activation, verify the exact GitHub master,
Vercel team/project/current deployment/alias, Supabase organization/project,
migration ledger and cleanup grants, current billing usage and a hard spend
boundary acceptable to the owner. Confirm the old GitHub ACK remains absent,
booking v2 remains off, and no database-local cleanup job exists. Configure
and test the free Healthchecks check and alert delivery to the named primary
and backup operators. Measure actual sweep duration, backlog drainage, and
Function usage with disposable or isolated inputs. An activation change would
need its own reviewed schedule configuration and production-only secrets;
merging this adapter alone must never create scheduled traffic.

During a staffed activation window, observe the first genuine Cron request,
its host and schedule header, both completed sweeps, and the independent
Healthchecks ping. If the Vercel host differs from the pinned QA alias, this
adapter fails closed and needs review before any retry. A missed run, partial
sweep, busy result, Healthchecks failure, or expired heartbeat must not be
treated as success. Keep booking v2 disabled until the existing two-hour
freshness fence and owner acceptance test are independently verified.

References: [Vercel Cron usage and pricing](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing),
[Vercel Cron authentication and deployed secret behavior](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs),
and the [existing GitHub OIDC candidate](GLOW-56-github-oidc-cleanup-candidate.md).

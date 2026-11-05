# GLOW-56 manual cleanup operator draft

This is code-only and disabled by default. It adds no schedule, secret,
policy row, Supabase migration, hosted SQL, alert destination, or v2 flag.
`ops/booking-v2-cleanup.mjs` is pinned to the existing GlowFlow QA project
`rfwhqutkiztxkagbhevp`; it refuses another project ref or URL. Do not use it
on MowFlow or on the future `glowflow.beauty` production environment.

The runner requires an explicit QA execution acknowledgement, a separate
server-only service-role credential, and operator-supplied bounded batch,
call, and wall-time limits. It invokes the existing `service_role`-only intent
sweep first, then the quota sweep. Each incomplete pass may continue only
within those limits. Busy, incomplete, malformed, timed-out, or failed RPCs
produce a nonzero exit. Output has a fixed event, stage, code and aggregate
counts only. It never prints the credential, customer contact, browser token,
IP address, intent ID, raw RPC error or response body. HTTP redirects are
rejected before credentials can be forwarded, and RPC response bodies are
limited to 4,096 bytes.

A complete result transactionally stamps each sweep's freshness heartbeat.
The private heartbeat tables are not exposed through the Data API, so this
runner cannot independently read their previous age or detect a scheduler
that never invoked it. A separate monitored schedule and missed-run alert are
required before v2 activation. A partial intent sweep clears its heartbeat,
so new preparations fail closed; it may also leave due contact data awaiting
scrubbing and therefore needs prompt operator attention.

This draft deliberately adds no GitHub Actions schedule or manual workflow.
Before any hosted use, the owner must choose and verify a no-pay scheduler
with enough margin below the two-hour freshness gate, bounded throughput for
expected backlog, a named primary and alternate operator, a monitored alert
destination, acknowledgement and escalation timing, and secret custody.
The current provider plan limits and alert delivery must be rechecked. The
existing no-pay QA runbook found that a new Supabase branch/project incurs
cost and generic Vercel Preview database isolation is unverified. There is
no authorized hosted v2 activation or production cleanup from this draft.

# GLOW-56 no-pay QA and cutover readiness

**Status update (November 7, 2026):** all three GLOW-56 forward database
migrations were applied individually to the named GlowFlow QA project with
matching history, leaving 44 remote rows. References below to 41 or 43 hosted
rows and unapplied migrations are historical evidence. The final gate remains
in `legacy` mode with `ever_v2 = false`; the later GLOW-27 migration remains
unapplied. See the [gate rollout result](GLOW-56-gate-hosted-smoke-plan.md).
This document does not authorize v2 activation or another hosted write.

Status: runbook only. Adapted from the documentation-only draft PR #201 at
`d54fdb7894fc57b0aeac31419a44f1bffa2c5308` after the consolidated
recovery code in PR #218 merged to `master` as
`d27c72c4e0e695caed4dfe80792f518a93871a19` on November 5, 2026.
This document applies no SQL, changes no environment setting, creates no
provider resource, sends no booking request, and does not authorize v2.
GLOW-56 stays In Progress until the hosted contract and owner acceptance
journey are verified.

## Boundary and no-pay rule

- Scope is repository `mocktar2021/glowflow`, Vercel team
  `team_ObLZOyZ2aT7LLu4cjxQGJPzJ` and project
  `prj_YZ96jIX5QEOOI70zUlbHSaIqQbsu`, and Supabase organization
  `goutxcrujaxjjssbjfsn` and project `rfwhqutkiztxkagbhevp`. Never use
  MowFlow as a test target.
- The November 5 read-only database check found 41 hosted migration-history
  rows through `20261104004728`. The three GLOW-56 migrations now committed
  to Git were **not** applied to hosted Supabase:
  `20261104184112_glow56_private_public_booking_intents.sql`,
  `20261104234445_glow56_public_booking_quota.sql`, and
  `20261105124804_glow56_public_booking_contract_gate.sql`. This observation
  is not a substitute for a fresh preflight before any future hosted action.
- Current Vercel configuration assigns one `NEXT_PUBLIC_SUPABASE_URL` entry
  to Production **and** generic Preview. Production and Preview have separate
  `SUPABASE_SECRET_KEY` entries, but their values are hidden and separate
  key entries do not establish separate databases. Generic Preview therefore
  shares the current Supabase backend address and is **not an isolated QA
  database**. Do not enable v2 or run state-changing booking tests there.
  A branch-specific override and a verified separate database would need
  their own review; neither is assumed here.
- A prior provider quote was $0.01344/hour for a new Supabase branch and
  $10/month for a new project. Neither is automatically free under the
  owner's no-pay constraint. Do not create either, accept a cost prompt,
  upgrade, or change billing. Recheck current pricing before proposing any
  hosted isolation option. The default QA path is disposable local PostGIS.

## Safe no-pay verification track

1. Start from the reviewed current `master`, not the obsolete PR #180/#191/
   #197/#200 assembly described in source draft #201. In a disposable local
   PostgreSQL/PostGIS database, apply the repository's ordered migrations,
   including the three GLOW-56 versions above. The contract gate installs in
   `legacy` mode; transition that disposable database through `frozen` and
   `v2` only inside the isolated test harness. Do not use `db push` against
   hosted GlowFlow or seed a hosted quota policy merely to run tests.
2. Keep fictional tenants, staff, contacts, and appointments. Run the
   versioned migration, guarded rollback, RLS/grant, quota, cleanup-cadence,
   route-to-PostGIS, and browser-to-PostGIS suites. Verify `anon`,
   `authenticated`, `service_role`, and cross-tenant boundaries. Record the
   exact Git SHA, migration fingerprints, and test run IDs.
3. In FR, EN, and ES, model a server-committed appointment whose 201 response
   is lost, then a visitor trying a changed slot. The same browser must keep
   the original intent locked until authoritative reconciliation, and there
   must be exactly one appointment. Cover unchanged retry, true non-commit,
   commit-response loss, 429/503 after the appointment is saved, expired or
   invalid signed cookies, missing local marker, and concurrent tabs. A
   generic Check must never create an appointment.
4. Race `legacy -> frozen` with an in-flight legacy booking in two database
   sessions. After freeze, old-page writes and direct legacy booking RPC calls
   must fail closed. In `v2_no_prepares`, new cookies, sessions, and prepares
   must fail while exact existing-intent recovery still works. Test lock
   timeout and guarded rollback. These proofs are local, not a claim about
   hosted Supabase or Vercel forwarding.
5. Safe production or Preview smoke checks are anonymous **GETs only**:
   public localized pages, public booking page, and the unauthenticated
   client-directory redirect. They can establish route availability but
   cannot prove v2, database isolation, signed-cookie persistence, or booking
   safety. Do not send live booking, payment, or notification requests.

## Preview forwarding check, without booking or database writes

The local harness injects synthetic forwarding headers and cannot prove
Vercel's trusted-header behavior. Existing draft PR #205 contains a temporary,
default-off, Preview-only, database-free GET probe that returns only booleans,
never an IP, cookie, digest, or credential. It was deliberately excluded from
merged PR #218. If separately reviewed for a protected Preview, compare an
ordinary GET with a fixed QA sentinel supplied in `x-forwarded-for`. If the
sentinel reaches the app as trusted client IP, keep v2 off. Remove the probe
before any production merge. Neither that check nor a READY Preview proves a
separate Supabase backend.

## Cleanup, alert, and key prerequisites

The merged SQL seeds no quota policy and installs no scheduler. New bootstrap
and prepare operations require complete intent and quota cleanup sweeps within
the approved two-hour freshness window. Before activation, choose a no-pay
schedule with margin below that window, bounded repeated sweeps until
`complete`, and an independently monitored alert for missed, failed, busy, or
incomplete runs. Assign a primary and alternate responder, acknowledgment
time, escalation, and verified alert delivery. A stale sweep must fail new
admission closed, not silently bypass the policy. Existing-capability
recovery needs its separate bounded budget.

The manual QA cleanup runner in `ops/booking-v2-cleanup.mjs` is disabled by
default, pinned to the existing GlowFlow QA project, and cannot detect that
nobody invoked it. It is not a scheduler or alert. Supabase `pg_cron` was
available but not installed at the November 5 read-only check; enabling it,
creating a job, or adding a protected HTTP cron endpoint is a separate hosted
change. Do not assume a Vercel Hobby cron or paid rate-limit entitlement.

Use distinct server-only 32-byte signing and quota-HMAC keys, separately
scoped to QA and production. Never put them in `NEXT_PUBLIC_` variables or
logs. Rotating the cookie key invalidates same-browser recovery unless the
approved 24-hour window is preserved; keep terminal intent records for the
approved three days. Follow the reviewed key-rotation runbook before cutover.

## Hosted cutover and rollback gate

No code merge, local test, or Preview result authorizes hosted SQL. Before
each hosted migration, freshly verify the exact GlowFlow organization and
project, ledger, schema and privilege fingerprints, migration order,
rollback, and security advisories. Stop on any difference. Obtain separate
approval for the exact SQL and migration-history entries; do not use
`db push` as a shortcut.

The application flag alone cannot fence an older deployment or a legacy RPC
already in a database transaction. The versioned database gate provides a
transactional `legacy -> frozen -> v2` path for the named public booking RPCs
and private intent/session writes. It does **not** block arbitrary trusted
`service_role` direct writes to public appointments or clients. Verify
service-role credential custody before activation. On November 5, the owner
accepted the narrower RPC-scoped MVP boundary and a bounded pause of new
online bookings with manual salon support for unresolved legacy attempts.
Staffing, timing, and the exact cutover still need their own verified release
plan; this choice is not hosted SQL or activation approval. A request-key-only
legacy lookup remains a separate implementation. Never reinterpret an old
ambiguous request as a new v2 intent.

After v2 has accepted an intent, rollback is `v2_no_prepares`, with existing
cookie-bound reconcile, commit, cancel, and acknowledge still available.
Never return to arbitrary-key legacy creation or remove recovery keys/code
during the approved window. Verify exact production commit and alias, safe
public GETs, an isolated synthetic journey, runtime errors, and the owner
acceptance test before marking GLOW-56 Done.

Sources: draft PR #201; merged PR #218; current repo migrations and tests;
[Vercel request headers](https://vercel.com/docs/headers/request-headers),
[Vercel Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs), and
[Supabase Cron](https://supabase.com/docs/guides/cron). Provider settings and
pricing can change; recheck them before any hosted cutover.

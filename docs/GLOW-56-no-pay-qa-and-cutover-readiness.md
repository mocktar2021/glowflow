# GLOW-56 no-pay QA and cutover readiness

Status: runbook only, prepared from read-only checks on November 4, 2026
(America/New_York). It applies no SQL, creates no branch or project, changes no
environment variable, deploys nothing, and does not authorize activation. The
public booking v2 flag remains off. Keep GLOW-56 In Progress until the hosted
contract and the owner acceptance test are verified.

## Verified boundary and cost

- Repository: `mocktar2021/glowflow`. Vercel team:
  `team_ObLZOyZ2aT7LLu4cjxQGJPzJ`; project:
  `prj_YZ96jIX5QEOOI70zUlbHSaIqQbsu`. At this check,
  `glowflow.mocktar.com` pointed to a READY production deployment of master
  commit `9e01633b0df5bbc17444091e42efbab46a5dc6f5`, not the v2 drafts.
- Supabase organization: `goutxcrujaxjjssbjfsn` (Mocktar Technologies);
  GlowFlow project: `rfwhqutkiztxkagbhevp`, `us-east-1`, healthy. Its branch
  list contained only the default `main` branch. Do not touch any other
  project, including MowFlow.
- The organization is on Supabase Pro. Its provider cost quote for a *new*
  branch was **$0.01344/hour**; a *new* project was **$10/month**. Neither is a
  free isolated QA environment under the owner's no-pay constraint. Do not
  create one, accept a cost prompt, upgrade, or buy capacity without a new
  explicit decision. The default is local-only QA. Hosted v2 QA needs the
  owner to supply a verified free isolated database in scope or explicitly
  revise the no-pay constraint after reviewing the exact cost; neither choice
  has been made.
- Vercel lists no custom environment. Generic Preview has a
  `SUPABASE_SECRET_KEY` entry and a `NEXT_PUBLIC_SUPABASE_URL` entry shared in
  scope with Production; their encrypted values were not readable. Isolation
  is therefore **unverified**, not proved absent. No v2 flag, v2 cookie key or
  age, quota HMAC key, or `CRON_SECRET` was listed. Protected Preview SSO is on
  except for custom domains. Never turn v2 on in generic Preview or point an
  enabled Preview at the GlowFlow main database while isolation is unproved.

## No-pay test track

1. Use a disposable local PostgreSQL/PostGIS instance and local Next.js test
   server. Assemble the two still-separate draft tracks locally: database PR
   #180 (intent migration), then #191 (cleanup revision), then #197 (quota
   migration, exact head `505ff4e989689f8beb3faff3496790ba14d517e0`),
   alongside API/browser PR #200 (exact head
   `240f1ae397acebf536782c80faf0fd6b2d7c4709`, stacked on #199 and #198).
   After the baseline migrations, apply the reviewed intent migration
   `20261104184112` before quota migration `20261104234445`, only in that
   disposable database. PR #200 alone contains neither SQL migration; its
   route fails closed without the quota RPC. Pin the assembled source hashes
   in the QA record, and do not merge the drafts merely to run local tests.
   Use fictional tenants, staff, contacts, and appointments. Test RLS and
   grants as `anon`, `authenticated`, and `service_role`; do not copy customer
   rows or secrets.
2. Run the deterministic v2 API/browser suite in FR, EN, and ES: committed
   response lost then changed slot, unchanged retry, true non-commit, 429 and
   503 during bootstrap/prepare/reconcile, invalid or expired signed cookie,
   lost storage marker, and concurrent tab. Explicitly test commit response
   loss and commit 429/503 *after* the original appointment is saved: the
   pending marker must retain the exact intent ID, changed-booking controls
   must stay locked, and authoritative reconciliation must return the original
   confirmation without a second prepare, commit, or appointment. Assert the
   appointment count remains one both before and after denial and recovery.
3. Exercise quota caps concurrently at the exact boundary, shared-IP fairness,
   browser-plus-tenant isolation, IPv4/IPv6 canonicalization, fixed-window
   boundary bursts, missing/spoofed IP context, missing HMAC key, bounded
   expiry cleanup, and stale cleanup fail-closed. Local harnesses may inject a
   *synthetic trusted IP*; a public local server must not trust visitor-supplied
   forwarding headers.
4. Test the proposed legacy cutover gate with two database sessions: a legacy
   booking holds its transaction while `legacy -> frozen` waits; after freeze,
   direct legacy RPC and old-page writes cannot create appointments. In `v2`,
   an intent-bound commit works; in `v2_no_prepares`, new prepare fails while
   existing-intent recovery remains available. Test lock timeout and rollback.
   The gate and private executor/grant refactor are still design work, not an
   installed protection.

For the hosted IP trust boundary, the useful no-pay Preview check before
database isolation is a **read-only header-shape diagnostic with v2 off**.
Safe read-only GET and static-route smoke checks can still establish basic
Preview availability, but cannot prove database isolation or booking safety.
On a protected GlowFlow Preview, a separately reviewed temporary GET can
return booleans such as
`has_forwarded_ip`, `single_valid_ip`, and `vercel_copy_matches`. Compare an
ordinary request with one that supplies a forged `x-forwarded-for` header to
verify Vercel's overwrite behavior. Never return or log the raw address,
cookie, HMAC digest, credentials, or bypass token; perform no booking POST or
database call. Remove the diagnostic before production merge. A local test
cannot prove the hosted forwarding trust boundary.

## Scheduler, alerts, and key prerequisites

The draft quota SQL seeds no policy and installs no scheduler. Its
`bootstrap` and `prepare` calls require a completed sweep within two hours.
The sweep RPC deletes at most 1,000 expired rows per call, and only a full
sweep refreshes that signal. Before activation, review a schedule with enough
margin (candidate: every 30 minutes), bounded repeat calls until `complete`,
and an alert on failed/busy/incomplete runs or a sweep age approaching two
hours. Name a monitored operator and test alert delivery. A stale sweep must
block new capabilities, not silently bypass the quota. `reconcile` keeps its
separate recovery budget while cleanup is stale.

On the GlowFlow main database, `pg_cron` is available but not installed.
Enabling it, scheduling SQL, or adding a protected HTTP cron endpoint is a
separate hosted change. Vercel Cron targets production deployments; it is not
an isolated Preview scheduler. Do not rely on an unverified free-plan cron or
WAF entitlement, and do not add a paid external rate-limit service. Supabase
documents `pg_cron` run monitoring in `cron.job_run_details` if that route is
later reviewed and approved.

Use distinct, server-only 32-byte random keys for quota HMAC and booking-cookie
signatures; never use `NEXT_PUBLIC_`, share QA/production keys, or log key
material. A quota HMAC rotation resets effective buckets, so schedule it with
an abuse-monitoring plan. Rotating the cookie signing key invalidates active
same-browser recovery unless verification overlaps the approved 24-hour
cookie window. Keep cookie-based recovery available for that window and retain
terminal intent records for the approved three days before cleanup.

## Hosted cutover and rollback gate

No local or Preview result authorizes main Supabase SQL. Before each hosted
migration, recheck the exact GlowFlow project and organization identity,
migration ledger, schema and privilege fingerprints, migration order, rollback,
and security advisories. Stop on any mismatch and obtain separate approval for
the exact SQL. Do not use `db push` as a shortcut or seed quota values by
merging code.

An application flag alone cannot fence a legacy POST already inside the
database transaction, an older deployment, or a direct service-role RPC. The
proposed database gate needs a reviewed private executor/grant refactor and
transactional `legacy -> frozen -> v2` tests before production use. The owner
must separately accept a short booking pause and choose either manual salon
support for unresolved legacy attempts or a reviewed request-key-only lookup.
Do not silently create a new v2 intent for an old ambiguous request.

Once v2 accepts an intent, rollback is `v2_no_prepares` with commit, cancel,
acknowledge, and reconciliation still available. Do not revert to arbitrary-key
legacy creation or remove signing keys and recovery code. Verify the exact
production commit/alias, safe public GETs, an isolated synthetic journey, and
runtime errors before marking GLOW-56 Done. No live booking, payment, email,
or telemetry activation is part of this runbook.

Sources: [Vercel request headers](https://vercel.com/docs/headers/request-headers),
[Vercel Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
[Supabase Cron](https://supabase.com/docs/guides/cron), provider project/env/branch
read-only checks, and the draft GLOW-56 quota and legacy-cutover contracts.
The Supabase changelog endpoint returned CONNECT 403 in this workspace, so
recheck current provider guidance before a hosted change.

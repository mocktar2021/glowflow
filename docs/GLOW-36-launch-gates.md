# GLOW-36 launch gate record

This is a dated repository evidence inventory begun on 2026-10-18, not permission
to launch and not a claim that every gate is green today. Keep GLOW-36 In Progress
until the product owner records a go/no-go decision against one exact production
commit and release scope. A supervised pilot and a public paid launch must not
be treated as the same decision. Record any pilot exception explicitly; do not
silently waive a paid-launch gate.

## Verified 2026-11-01 20:14-20:15 UTC production checkpoint, not launch approval

GitHub `mocktar2021/glowflow` `master` was
`032608f857279bf6fe28c2b3cf6df4e49d27086f`. Its master-push
[GlowFlow CI](https://github.com/mocktar2021/glowflow/actions/runs/41335092317),
[Database security](https://github.com/mocktar2021/glowflow/actions/runs/41335092246),
and [browser checks](https://github.com/mocktar2021/glowflow/actions/runs/41335092291)
all completed successfully on that exact commit. Vercel team
`team_ObLZOyZ2aT7LLu4cjxQGJPzJ`, project
`prj_YZ96jIX5QEOOI70zUlbHSaIqQbsu`, reported production deployment
`dpl_2uAFxvuJFdGGoThEdRqCBQZdakDj` READY for the same GitHub SHA; a separate
alias lookup mapped `glowflow.mocktar.com` to that deployment.

The earlier 2026-11-01 18:13 UTC GLOW-36 Jira evidence comment `11913` records
22 read-only FR/EN/ES public and signed-out client-directory GETs through the
production alias, each yielding HTML 200 after any same-origin redirect with
that deployment marker. A fresh, smaller 20:15 UTC connected-fetch sample of
`/fr/salons`, `/en/salons`, `/es/salons`, and `/fr/dashboard/clients` also
returned HTML 200 with the same marker; the signed-out French client-directory
request rendered the French login heading. The connected fetch follows
same-origin redirects, so these results do not independently prove the redirect
status code. A one-hour Vercel runtime-error query at this checkpoint found no
errors in its sampled window. Neither sample exercised a signed-in journey,
booking, payment, provider send, or hosted SQL.

A separate read-only Supabase metadata recheck identified organization
`goutxcrujaxjjssbjfsn` and healthy GlowFlow project `rfwhqutkiztxkagbhevp`.
Its hosted ledger still contained 35 version/name pairs versus 36 entries and
files on this exact `master`; the sole local-only version was
`20261018000135_schedule_confirmed_appointment_notifications`. Table/type
metadata alone did not expose its private function or appointment trigger.
After the exact project/ledger preflight, a separately approved, catalog-only
SELECT on 2026-11-01 UTC against the hosted `postgres` database returned
`function_present=false` for `private.enqueue_confirmed_appointment_email()`
and `trigger_present=false` for `appointments_enqueue_confirmed_email` on
`public.appointments`; the trigger's enabled/internal/function fields were
null because the trigger was absent. The exact query time was not recorded.
This confirms a **scoped hosted schema gap** for those two objects, not a
fingerprint or equivalence assessment of the rest of the schema. A
migration-history-only repair would misrepresent this state and is not valid.
Draft [PR #139](https://github.com/mocktar2021/glowflow/pull/139) remains
unmerged and unapplied; keep messaging disabled until the predecessor SQL,
consent semantics, other relevant schema/authorization state, and an approved
hosted change plan are reviewed. No SQL change was made by these checks.

This checkpoint establishes only the stated exact-commit production and sampled
read-only behavior. The leaked-password-protection warning from the earlier
advisor check was not rechecked here. Historical-point recovery, named incident
and alert coverage, country-specific legal and salon-policy approval, payment
and refund controls, test-fixture cleanup, and the product owner's release
scope and go/no-go decision remain **Pending**. GLOW-36 stays In Progress.

## Verified 2026-11-01 16:29 UTC production checkpoint, not launch approval

At 2026-11-01 16:29 UTC, GitHub `mocktar2021/glowflow` `master` was
`cdf73b53e1b4b43f51dfb59756aa60e2491aa3cc`. Its master-push
[GlowFlow CI](https://github.com/mocktar2021/glowflow/actions/runs/41326277971),
[Database security](https://github.com/mocktar2021/glowflow/actions/runs/41326278050),
and [browser checks](https://github.com/mocktar2021/glowflow/actions/runs/41326277964)
all completed successfully. This is combined-branch evidence for that exact
commit, not a pass for any later commit or hosted database revision.

Vercel team `team_ObLZOyZ2aT7LLu4cjxQGJPzJ`, project
`prj_YZ96jIX5QEOOI70zUlbHSaIqQbsu`, reported production deployment
`dpl_Cwa83rC3tvLux1Vo9AsfRSyj8Ygc` READY for that exact GitHub SHA, and a
separate alias check mapped `glowflow.mocktar.com` to it. Twenty-two read-only
GETs through the Vercel-connected fetch checked `/` plus each FR/EN/ES landing,
salon search, login, privacy, terms, support, and signed-out client-directory
route. All yielded HTML 200 after any same-origin redirect and identified the
same deployment; the client-directory responses showed sign-in content rather
than the private directory. This fetch follows same-origin redirects, so it
does not independently establish the redirect status code. A one-hour Vercel
runtime-error scan found no errors in the sampled window.

These public and signed-out checks do not verify a signed-in workflow, hosted
Supabase authorization or recovery, provider health, a charge or refund, legal
approval, or launch readiness. No booking, payment, hosted SQL, or provider
message was initiated for this checkpoint. Recheck all identities and gates
against the actual release candidate before an owner go/no-go decision.

## Read-only 2026-11-01 17:16-17:19 UTC Supabase checkpoint, not launch approval

The connected Supabase organization listing identified `goutxcrujaxjjssbjfsn`
as Mocktar Technologies. Its project listing and project metadata identified
`rfwhqutkiztxkagbhevp` as **glowflow** in that organization, `us-east-1`,
`ACTIVE_HEALTHY`. The hosted migration ledger returned 35 version/name pairs.
All 35 match `supabase/migration-history-map.json`; the repository map has one
additional version, `20261018000135_schedule_confirmed_appointment_notifications`.
That GLOW-27 migration records consented email schedules; its checked-in SQL
does not enable a worker, provider, cron job, or customer messaging. A missing
ledger entry does **not** prove that the hosted schema differs: no hosted schema
fingerprint, SQL, or authorization test was run. Reconcile this exact ledger
gap and verify the schema under a separately approved change/test plan before
claiming the hosted database matches the release candidate.

The [Supabase Security Advisor](https://supabase.com/docs/guides/deployment/going-into-prod)
reported one WARN, [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
and one INFO, [RLS enabled with no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
on `public.stripe_sandbox_events`. The checked-in sandbox migration enables
RLS, revokes `public`/`anon`/`authenticated` privileges, and grants only
`service_role`, so the latter notice is consistent with an intentional
deny-all client policy, not evidence of a client-access vulnerability.
The Performance Advisor reported 29 notices: 14 unindexed foreign keys,
12 unused indexes, two multiple-permissive-policy warnings, and one Auth
connection-allocation notice. These are advisory findings, not a performance
or authorization test. The advisor findings were observed at
2026-11-01 17:16:27 UTC; review them again for the actual release candidate.

This checkpoint changed no hosted schema, data, Auth, Storage, migration
history, or provider setting. Leaked-password protection remains an open
security setting for the owner to assess; the ledger difference and hosted
authorization/fingerprint evidence remain pending. GLOW-36 remains In Progress.

## 2026-11-01 local notification-consent blocker, hosted state unverified

Local PostgreSQL review of the checked-in notification persistence migration
found that `private.notification_delivery_eligible` can return SQL `NULL` for
a due outbox row with no consent, while `claim_notification_delivery` checks
`IF NOT eligible THEN`. In PL/pgSQL, `IF NOT NULL` does not reject the claim.
This is a local SQL contract failure, not evidence that the hosted function has
the same definition. No sender, worker, or provider delivery was activated or
tested. Keep messaging disabled and GLOW-29 pending until a fail-closed fix,
effective-time consent semantics, the missing hosted predecessor migration,
and hosted authorization/fingerprint evidence are reviewed under a separately
approved deployment plan. Do not treat a green public route check as proof of
notification safety.

## Historical verified 2026-11-01 15:09 UTC snapshot, not launch approval

At 2026-11-01 15:09 UTC, GitHub `mocktar2021/glowflow` `master` was
`72d52c5b5a2448f15f8e585270dbc2588ce37bb5`, the merge of
[PR #118](https://github.com/mocktar2021/glowflow/pull/118). Its reviewed
test-only head `6ecaa85b4939bd1c48305536edd6cdeead53c8bc` passed
[GlowFlow CI](https://github.com/mocktar2021/glowflow/actions/runs/41318482564),
[Database security](https://github.com/mocktar2021/glowflow/actions/runs/41318482745),
and [browser checks](https://github.com/mocktar2021/glowflow/actions/runs/41318482651)
with 74 of 74 browser tests passing. The merged tests include synthetic
booking, payment, cancellation, Auth, and Storage recovery fixtures. They do
not exercise a hosted charge, refund, or historical backup restore.

Vercel team `team_ObLZOyZ2aT7LLu4cjxQGJPzJ`, project
`prj_YZ96jIX5QEOOI70zUlbHSaIqQbsu`, reported production deployment
`dpl_J4ZdqbTP2doww5E3s66jFMijTr3K` READY for that exact `master` SHA,
and `glowflow.mocktar.com` aliased it. Read-only GETs of `/fr`, `/en/salons`,
and `/es/privacy` returned 200 and identified the same deployment. Vercel's
recent 30-minute runtime-error scan reported no errors. These sampled public
routes and logs do not verify signed-in workflows, all routes, provider health,
or that no error exists outside the sampled window. This check did not run
hosted Supabase SQL, write a booking, or initiate a payment.

The remaining historical restore, named incident/alert coverage, current
country-specific legal approval, hosted authorization, and paid-launch
financial gates below remain **Pending**. Recheck GitHub, Vercel, Supabase,
and provider identities against the actual launch candidate before any owner
go/no-go decision. Do not carry this snapshot forward as standing approval.

## Evidence already available

| Area | What the repository proves | What it does not prove |
| --- | --- | --- |
| Privacy, terms, support | `lib/legal-content.ts` has FR/EN/ES copy, a 2026-09-24 effective date, the public support address, and cancellation/deposit guidance. Localized routes and `tests/legal-support.test.mjs` cover presence and links. `docs/GLOW-35-release-readiness.md` records a September 24 production check. | A fresh legal review for every launch country, or that a salon has published its own applicable policy. The platform copy does not define a platform refund entitlement. |
| Cancellation and money | The terms direct salon-service disputes to the salon and say an online deposit is due only when Stripe Checkout shows it. A localized public notice now says when a salon has not published policy text; it does not supply cancellation or refund terms. `GLOW-24` remains Backlog. `docs/GLOW-35-release-readiness.md` records live deposits, refund rules, receipts, and reconciliation as incomplete. | Configurable cancellation windows, authorized live refunds, no-show handling, and a complete paid customer journey. |
| Support and incident response | The public support address is `support@mocktar.com`. `docs/GLOW-36-recovery-drill.md` records working incident-lead and database-owner roles and a 24-hour RPO and 4-hour RTO target. `docs/GLOW-34-observability-slice.md` documents safe booking error IDs. | A currently confirmed named primary and alternate, monitored support and alert destinations, an exercised escalation, or measured achievement of the recovery targets. `GLOW-34` remains In Progress. |
| Database recovery | `tests/recovery-run.mjs` uses only guarded loopback PostgreSQL and synthetic records. `.github/workflows/security.yml` runs the logical backup/restore drill on disposable PostgreSQL 16. `docs/GLOW-36-recovery-drill.md` records a September 24 isolated hosted current-state clone, count/Auth/bucket comparison, synthetic Storage-file recovery, and a later signed-in owner journey. | A selected historical daily or PITR recovery point, full file-volume recovery, provider settings/secrets restoration, or a measured production-equivalent RTO. A database archive does not include Storage file contents. |
| Security and quality | `.github/workflows/ci.yml`, `security.yml`, and `browser.yml` define build/unit, database authorization/recovery, and browser checks. | A green result for an arbitrary future release commit, a current Supabase advisor review, or hosted Auth/Storage behavior from local substitutes alone. |
| Localization and domain | FR/EN/ES legal routes and tests exist. Prior release notes record localized production checks and the `glowflow.mocktar.com` domain. | Current exact-commit production rendering, TLS/canonical behavior, and complete booking/payment copy in each launch market. |

The September recovery and release notes are dated historical evidence. Some
paragraphs describe migrations or PRs that were pending at the time; do not
use those paragraphs as a current deployment status. Recheck the launch commit,
database migration ledger, hosted settings, and production behavior before a
go/no-go decision.

For a repeatable read-only public route check, run
`node tests/public-release-smoke.mjs` from the repository. It makes 22
anonymous GET requests only to `https://glowflow.mocktar.com`. It checks the
French root redirect and FR/EN/ES landing, salon, login, privacy, terms, and
support pages. It verifies that each anonymous client-directory request
redirects to the same-locale login. It does not send bookings or payments,
read response bodies, authenticate, or verify a signed-in client workflow.
A public HTML 200 confirms route availability, not legal accuracy, current
approval, policy coverage, or that the Vercel alias points to the exact GitHub
commit.
Record the separate GitHub/Vercel identity and runtime-error evidence alongside
its result; a pass is not a launch approval.

## Historical production snapshot, not current status or launch approval

At the 2026-10-19 UTC observation, GitHub `master` was
`69573bfa7b4178193059a10f458ce705dd55d6b0`. Vercel deployment
[`dpl_q7fDwt4H8Agr9gZtTzYcsNuyM4ot`](https://vercel.com/tairoumocktar-9966s-projects/glowflow/q7fDwt4H8Agr9gZtTzYcsNuyM4ot)
was READY for that exact commit on the GlowFlow production project, and the
`glowflow.mocktar.com` alias pointed to it. Vercel reported the project domain
verified and its external-DNS CNAME configured without conflicts. Read-only
HTTPS GETs returned French content at `/` and 200 at the published salon's
`/fr/book/mocktar-braiding` route. The product owner confirmed the signed-in
dashboard and client directory loaded. [GLOW-10](https://mocktarltd.atlassian.net/browse/GLOW-10)
records the domain checks and rollback runbook; [GLOW-16](https://mocktarltd.atlassian.net/browse/GLOW-16)
records the accepted client-directory scope and signed-in owner verification.

Subsequently, [PR #91](https://github.com/mocktar2021/glowflow/pull/91) merged
as `1e4e22a2ad908ee625f67b8809682944b66dda4c`. The observation above
therefore cannot establish any later production build or alias. Consult a
separate exact-commit release check for the latest deployment.

The historical snapshot does not verify a historical backup restore, hosted
authorization/settings, alert delivery, all localized journeys, legal approval
for launch countries, or live financial operations. It expires when the
production alias, application commit, relevant database revision, or provider
configuration changes. Recheck those identities against the exact proposed
release before a launch decision; never carry a green result forward solely
because a URL is stable.

## Go/no-go checklist for an exact release

For each item, record the UTC observation time, evidence URL or artifact,
environment, verifier, result, and any exception. An empty box means unverified,
not failed. Do not put credentials, customer records, or payment details in the
record.

- [ ] Product owner states whether this is a supervised pilot or public paid
      launch, the operating countries, participating salons, and any explicit
      pilot limits.
- [ ] Product owner approves the current FR/EN/ES privacy, terms, support,
      cancellation, deposit, and no-show wording for those countries. Confirm
      each participating salon's policy is available before booking. `GLOW-24`
      must be resolved before claiming automated refund/no-show readiness.
- [ ] Support mailbox is receiving messages. Record the named incident lead,
      database operator, alternates, escalation path, coverage period, and
      approved customer-communication route. Confirm the alert destination and
      an exercised failure alert under `GLOW-34`.
- [ ] Confirm the actual Supabase backup schedule, retention, selected recovery
      point, and owner-approved RPO/RTO. Restore the selected historical point
      into an isolated project under a separately approved drill, including a
      separate Storage-file source. Record elapsed time and achieved recovery
      point using the evidence template below. Never restore over production to
      test this gate.
- [ ] For every migration included in this release, record the exact file and
      fingerprint, hosted ledger/schema preflight, and separate approval for
      the hosted change. Test its scoped rollback or forward-fix on an isolated
      database at the intended predecessor state, including data-preservation
      and authorization checks. Name the operator and the decision point for
      reverting application code versus applying a database recovery step.
      A rollback script in the repository is not evidence that the recovery
      path was tested. If no database change is planned, record that explicitly.
- [ ] Confirm the exact GitHub launch SHA and green CI, database-security, and
      browser runs for it. Review security advisors and tenant/anonymous role
      results for the intended database revision. Do not substitute an older
      green run or a clean local rebuild for hosted authorization evidence.
- [ ] For a paid launch, approve payment methods and merchant scope by country,
      cancellation/refund/no-show rules, tax and receipt requirements, and
      reconciliation ownership. Verify a live end-to-end charge, refund, failure,
      and webhook-idempotency path with an authorized test plan. Sandbox success
      alone is not enough.
- [ ] Confirm production Vercel project, Supabase project, Stripe account,
      environment owners, least-privilege access, and rollback contacts without
      recording secrets. Confirm a READY production deployment at the exact SHA,
      `glowflow.mocktar.com` alias and TLS, and FR/EN/ES discovery, booking,
      sign-in, owner, and support flows appropriate to the launch scope.
- [ ] Remove or retire public test services and disabled test staff fixtures
      where applicable, while preserving required payment and audit history.
- [ ] Product owner records the final go/no-go, exceptions, rollback trigger,
      decision time, and who will monitor the first operating period. Keep
      GLOW-36 In Progress if any required evidence or decision is missing.

## Exact-release decision record template

Copy this block into a dated, access-controlled release record. Link evidence
instead of copying customer data, credentials, secret-bearing logs, or payment
details. Use **Pending** when a check has not run, **Failed** when it ran and
failed, and **Not applicable** only with a written scope reason and product-owner
approval. A pilot exception does not turn an unmet paid-launch gate into a pass.

| Identity / decision | Value to record |
| --- | --- |
| Decision time (UTC), product owner, decision | Pending |
| Release type, countries, salons, pilot limits | Pending |
| GitHub repository, exact `master` SHA, CI/security/browser run URLs | Pending |
| Vercel team/project, deployment ID, production target, READY time, alias | Pending |
| Supabase organization/project, migration ledger and schema fingerprints | Pending |
| Included migrations, individual recovery plans and isolated test evidence | Pending |
| Payment and messaging provider mode and accountable owners, without secrets | Pending |
| Named incident lead, backup operator, alternates, support/alert contacts | Pending |
| Monitoring window, rollback trigger, prior READY deployment | Pending |

For every checklist gate above, add a row in the release record using this
format. Keep separate rows for legal/policy publication, support and alerting,
historical database plus Storage recovery, migration recovery, security/RLS,
FR/EN/ES journeys, domain/TLS, test-data cleanup, and, for a paid launch,
payments/refunds/tax/receipts/reconciliation. Record provider evidence
independently of repository tests.

| Gate | Applies to this release? | Pass / Failed / Pending / Not applicable | Evidence URL or artifact | Checked at (UTC) and by whom | Open risk, exception owner, retest trigger |
| --- | --- | --- | --- | --- | --- |
| Example: historical database and Storage restore | Yes | Pending | No selected historical-point drill yet | Not checked | Product owner to approve an isolated drill; rerun if backup policy changes |
| Example: migration-specific recovery | If release includes SQL | Pending | No isolated rollback or forward-fix result recorded | Not checked | Database operator to test at exact predecessor state before hosted approval |

The product owner signs a final **Go** or **No-go** only after reviewing every
applicable row. Record any supervised-pilot exception with its owner, expiry,
containment, and rollback trigger. Leave GLOW-36 In Progress while required
evidence or the exact-release decision is missing.

## Recovery exercise evidence template

Use `docs/GLOW-36-recovery-drill.md` for the guarded procedure. Before an
isolated hosted drill, record the approved source project and recovery project,
chosen backup timestamp and type, incident lead and operator, backup/Storage
object source, and agreed RPO/RTO. Afterward, record the start/end UTC times,
achieved recovery point, application/Auth/Storage counts and checksums,
authorization denials, signed-in FR/EN/ES journey, failures, cleanup, and
go/no-go review. A current-state branch clone must be labeled as such, not as
proof that a historical daily/PITR restore works. Do not publish credentials,
raw customer data, or provider secrets in the evidence.

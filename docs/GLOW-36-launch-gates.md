# GLOW-36 launch gate record

This is a repository evidence inventory as of 2026-10-18, not permission to
launch and not a claim that every gate is green today. Keep GLOW-36 In Progress
until the product owner records a go/no-go decision against one exact production
commit and release scope. A supervised pilot and a public paid launch must not
be treated as the same decision. Record any pilot exception explicitly; do not
silently waive a paid-launch gate.

## Evidence already available

| Area | What the repository proves | What it does not prove |
| --- | --- | --- |
| Privacy, terms, support | `lib/legal-content.ts` has FR/EN/ES copy, a 2026-09-24 effective date, the public support address, and cancellation/deposit guidance. Localized routes and `tests/legal-support.test.mjs` cover presence and links. `docs/GLOW-35-release-readiness.md` records a September 24 production check. | A fresh legal review for every launch country, or that a salon has published its own applicable policy. The platform copy does not define a platform refund entitlement. |
| Cancellation and money | The terms direct salon-service disputes to the salon and say an online deposit is due only when Stripe Checkout shows it. `GLOW-24` remains Backlog. `docs/GLOW-35-release-readiness.md` records live deposits, refund rules, receipts, and reconciliation as incomplete. | Configurable cancellation windows, authorized live refunds, no-show handling, and a complete paid customer journey. |
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
`node tests/public-release-smoke.mjs` from the repository. It makes ten anonymous
GET requests only to `https://glowflow.mocktar.com`, checks the French root
redirect, FR/EN/ES landing and salon pages, and verifies that each anonymous
client-directory request redirects to the same-locale login. It does not send
bookings or payments, read response bodies, authenticate, verify a signed-in
client workflow, or prove the Vercel alias points to the exact GitHub commit.
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
records the client-directory scope and remaining live-flow verification.

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
| Payment and messaging provider mode and accountable owners, without secrets | Pending |
| Named incident lead, backup operator, alternates, support/alert contacts | Pending |
| Monitoring window, rollback trigger, prior READY deployment | Pending |

For every checklist gate above, add a row in the release record using this
format. Keep separate rows for legal/policy publication, support and alerting,
historical database plus Storage recovery, security/RLS, FR/EN/ES journeys,
domain/TLS, test-data cleanup, and, for a paid launch, payments/refunds/tax/
receipts/reconciliation. Record provider evidence independently of repository
tests.

| Gate | Applies to this release? | Pass / Failed / Pending / Not applicable | Evidence URL or artifact | Checked at (UTC) and by whom | Open risk, exception owner, retest trigger |
| --- | --- | --- | --- | --- | --- |
| Example: historical database and Storage restore | Yes | Pending | No selected historical-point drill yet | Not checked | Product owner to approve an isolated drill; rerun if backup policy changes |

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

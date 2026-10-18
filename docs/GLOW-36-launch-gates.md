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

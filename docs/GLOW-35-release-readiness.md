# GLOW-35 / GLOW-36 release readiness — September 13, 2026

## Verified baseline

- PR 35 merged at fd16817315338f0bfdb66cfda84d3d8d8215dd5b. Production deployment dpl_DqATFr5MdwFhBbgYKjharX9swEuJ is READY and serves glowflow.mocktar.com. The English sign-in route returned HTTP 200.
- Dedicated preview sandbox Checkout collected a USD 25 test deposit and persisted checkout.session.completed as paid. The earlier expired session also persisted its expiration event. See GLOW-23-unpublished-sandbox.md.
- This is evidence for sandbox integration only. The sandbox ledger deliberately does not create real client appointments or real financial records.

## Release gates

| Gate | State | Required next evidence |
| --- | --- | --- |
| Authenticated dashboard accuracy | Implemented and locally tested | Signed-in workspace uses real management links without sample customer/financial claims; deployed owner smoke check remains |
| Build, lint, unit, browser and database checks | Local checks passed September 24 | GitHub minutes exhausted; owner requested local verification. Runtime differences recorded below |
| Real tenant isolation | Partial | Full historical bootstrap and every tenant table need reproducible database policy tests |
| Live deposits and Connect | Not ready | Separate live flow, real appointment lifecycle, approved merchant configuration, signed settlement and reconciliation |
| Refund/cancellation/no-show policies | Not ready | Approved policy plus implementation and failure/retry coverage |
| Cash/mixed checkout and accounting | Not ready | Persistent financial ledger, receipts, reconciliation and role tests |
| Messaging | Preview only | Consent, provider delivery, retries, opt-out and scheduled-job verification |
| Legal/support | Not ready | Owner-approved business identity, support contact, privacy/terms and cancellation/deposit content |
| Recovery | Not verified | Restore a backup into an isolated project and verify row counts, policies and critical flows |
| Operational alerts | Partial | Safe diagnostics in this wave; alert destination, ownership and an exercised failure alert still required |
| Test-data cleanup | Before salon publication | Retire the Test service and disabled test staff fixture; preserve sandbox payment audit records |

## Operational boundaries

Do not enable live payments by changing sandbox gates. Keep secrets in Vercel and provider settings. Never replay the migration directory against the shared project: historical bootstrap SQL and remote migration timestamps require reconciliation first. A successful build or sandbox charge alone does not establish production financial readiness.

Before merging an application-only release, check the exact PR head, verify preview behavior, and retain the previous READY deployment for rollback. After merging, verify the production deployment commit, HTTP routes, authentication redirects and affected owner flow. A code rollback does not undo database data or provider settings.

Jira: GLOW-35 critical-flow verification; GLOW-36 launch checklist; GLOW-34 diagnostics; GLOW-33 truthful reporting. These issues remain open while their complete acceptance criteria are unmet.

## September 24 local release verification

Application revision `dda0bac9096962e0219ecc20fdb5c181361cbb59`, PR 36:

- Lint and production build/type checking passed.
- Unit suite: 116 passed, 0 failed, 1 opt-in database test skipped in the ordinary suite.
- Separate database runner: 1 passed, 0 failed, 0 skipped; transaction/conflict and RLS assertions plus cleanup passed against disposable local PostgreSQL 14. The cluster was stopped afterward. CI normally uses PostgreSQL 16.
- Browser suite: 35 passed, 0 failed or skipped, in 503.4 seconds: 15 authenticated-route fixture cases and 20 booking, status, notification and confirmation cases.
- Browser runtime: Node 24.20.0, bundled Playwright 1.62.1, installed Chrome 153.0.8010.53. The documented local overrides were used; CI pins Node 22 and Playwright 1.58.2 with Chromium. This run does not establish identical results on those CI runtimes.
- Browser evidence is retained locally under `test-results/browser/` and `test-results/browser/auth/` (screenshots, runtime metadata and server logs); unit output is `test-results/release-unit.log`.
- Independent review found an authentication-page home link pointing at a missing locale root; it was corrected to localized salon discovery before final verification.

The owner confirmed GitHub Actions minutes were exhausted and requested local checks. Failed GitHub jobs did not execute their test steps; their status is not represented as passing. Vercel built the application revision successfully. No database migration, environment change or live payment activation is included. Fixture browser coverage does not replace a deployed authenticated owner smoke test or real payment integration evidence.

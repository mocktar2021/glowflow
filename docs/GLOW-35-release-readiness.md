# GLOW-35 / GLOW-36 release readiness — September 13, 2026

## Verified baseline

- PR 35 merged at fd16817315338f0bfdb66cfda84d3d8d8215dd5b. Production deployment dpl_DqATFr5MdwFhBbgYKjharX9swEuJ is READY and serves glowflow.mocktar.com. The English sign-in route returned HTTP 200.
- Dedicated preview sandbox Checkout collected a USD 25 test deposit and persisted checkout.session.completed as paid. The earlier expired session also persisted its expiration event. See GLOW-23-unpublished-sandbox.md.
- This is evidence for sandbox integration only. The sandbox ledger deliberately does not create real client appointments or real financial records.

## Release gates

| Gate | State | Required next evidence |
| --- | --- | --- |
| Authenticated dashboard accuracy | Fix in this wave | Signed-in workspace uses real management links without sample customer/financial claims |
| Build, lint, unit, browser and database checks | Pending final revision | CI checks must pass on the PR head |
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

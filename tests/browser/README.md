# GLOW-35 browser fixture checks

Run `npm ci`, `npx playwright install chromium`, then `npm run test:browser`.
The browser workflow installs Chromium with OS dependencies and uploads screenshots,
server output, and runtime metadata even on failure.

These isolated browser checks import the production booking and sandbox payment
status components into a small Next.js fixture. They cover FR/EN/ES booking payloads,
sandbox query and hash preservation when switching language, authoritative pending to
paid/failed/expired transitions, and unavailable checkout/status behavior. Each test
uses a fresh browser context; external network requests are blocked, booking and
checkout APIs are controlled fixtures, and sandbox POSTs to the real booking API fail.
No Supabase or Stripe application credentials are inherited by the fixture server.

This is component interaction evidence, not a deployed payment integration test. The
fixture does not load the application stylesheet, so its narrow viewport screenshots
are diagnostic evidence rather than mobile styling/accessibility certification.
Real Supabase session authorization, Stripe Checkout, signed webhook settlement, database
isolation, cash/mixed checkout and cancellation require their respective integration
checks. GLOW-35 is not complete solely from this suite.

## GLOW-35 critical-flow integration checks

`tests/critical-flow-actions.test.mjs` runs the production payment and calendar server
actions against a controlled, in-memory owner/member database adapter. It covers
French, English, and Spanish cash and externally processed card recording; invalid,
unauthenticated, over-balance, and cross-tenant failure paths; and owner/staff
cancellation success and denial. It verifies the trusted RPC payloads and localized
redirects, but does not claim a real card charge or hosted authorization check.

`tests/stripe-deposit-events.test.mjs` signs synthetic sandbox events with a fixture
webhook secret, then sends the raw bytes to the production webhook handler. It
checks paid completion, asynchronous success, asynchronous failure, expiration,
unpaid completion, tampering, and retryable persistence errors without contacting
Stripe. `tests/sandbox-database.test.mjs` covers event idempotency and reservation
state in an opt-in disposable local PostgreSQL database.

`tests/payment-recording-database.test.mjs` uses a separate opt-in disposable
local database to prove concurrent payment bounds, idempotency, mixed cash and
external-card settlement, and cancellation without an implicit refund. Set only
`GLOWFLOW_PAYMENT_RECORDING_TEST_DATABASE_URL` to a fresh local database named
`glowflow_payment_recording_test*` before running it. It applies the repository
schema and migrations, so never point it at a shared or hosted database.

CI preview screenshots and check results are release evidence for the isolated
browser fixture, not proof of a live Stripe payment. A real sandbox Checkout
round-trip and hosted owner/RLS verification remain separate launch gates.

CI uses pinned Playwright 1.58.2 and its installed Chromium. Optional local overrides
`GLOWFLOW_PLAYWRIGHT_PATH` (absolute module entry) and `GLOWFLOW_CHROMIUM_PATH`
(executable) support existing runtimes. The local September 10, 2026 verification
used bundled Playwright 1.62.1 and installed Chrome 152.0.7977.83 because the local
Chromium download was incomplete. This does not verify the pinned CI browser version.
Runtime metadata records whether overrides were used; it contains no credential data.

The GLOW-28/GLOW-42 extension also checks notification kind and locale fallback without mutation requests, selected-service booking payloads, and service re-selection across language changes.

## GLOW-28 authenticated-route fixture

`auth.browser.mjs` runs the actual production notifications server page and
`requireUser` inside Next.js. Only `lib/supabase/server` is replaced by a
fixture-scoped webpack alias. Cookie-selected fictitious identities and two in-memory
tenants exercise the ownership query; the production route contains no fixture
switch or authentication bypass. Each case uses an isolated browser context.

The 15 FR/EN/ES scenarios cover owner rendering and interaction, signed-out identity on
reload, anonymous login redirects, staff/cross-tenant denial, and fail-closed query
errors. Attempts to select another owner or tenant through query parameters do not
grant access. Denied destinations contain no preview controls or database diagnostic.
All non-read browser requests are blocked and fail the no-mutation assertion.

These are server-route/browser integration tests with a mocked authentication and
database SDK, not proof of real Supabase JWT verification, RLS policies, or deployed
owner access. Real authenticated-session and database isolation checks remain separate.
Screenshots and runtime/server evidence go to `test-results/browser/auth`.

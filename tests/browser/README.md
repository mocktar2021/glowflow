# GLOW-35 browser fixture checks

Run `npm ci`, `npx playwright install chromium`, then `npm run test:browser`.
The browser workflow installs Chromium with OS dependencies and uploads screenshots,
server output, and runtime metadata even on failure.

These nine isolated browser checks import the production booking and sandbox payment
status components into a small Next.js fixture. They cover FR/EN/ES booking payloads,
sandbox query and hash preservation when switching language, authoritative pending to
paid/failed/expired transitions, and unavailable checkout/status behavior. Each test
uses a fresh browser context; external network requests are blocked, booking and
checkout APIs are controlled fixtures, and sandbox POSTs to the real booking API fail.
No Supabase or Stripe application credentials are inherited by the fixture server.

This is component interaction evidence, not a deployed payment integration test. The
fixture does not load the application stylesheet, so its narrow viewport screenshots
are diagnostic evidence rather than mobile styling/accessibility certification.
Actual owner authorization, Stripe Checkout, signed webhook settlement, database
isolation, cash/mixed checkout and cancellation require their respective integration
checks. GLOW-35 is not complete solely from this suite.

CI uses pinned Playwright 1.58.2 and its installed Chromium. Optional local overrides
`GLOWFLOW_PLAYWRIGHT_PATH` (absolute module entry) and `GLOWFLOW_CHROMIUM_PATH`
(executable) support existing runtimes. The local September 10, 2026 verification
used bundled Playwright 1.62.1 and installed Chrome 152.0.7977.83 because the local
Chromium download was incomplete. This does not verify the pinned CI browser version.
Runtime metadata records whether overrides were used; it contains no credential data.

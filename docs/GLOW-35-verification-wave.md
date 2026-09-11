# Booking and verification wave

Base: merged PR 30, master `324dd59791a2eb043cf20d1de635f2abaf08c359`.

## Scope

- GLOW-25: native keyboard time selection, localized contact and salon-time-zone guidance, stale availability protection, retry after failed availability or slot conflict, and a fresh selection after another booking. Unknown offline salon slugs return 404; the explicit atelier-belle demo remains available. Named staff selection still requires a public staff API contract.
- GLOW-35: Chromium exercises production booking/status components in an isolated local fixture with mocked API responses. External browser requests are blocked. This is browser component-flow coverage, not deployed Stripe Checkout or authenticated tenant end-to-end coverage.
- GLOW-37: CI runs disposable local PostgreSQL transaction and sandbox role tests without silently skipping, plus source RLS declarations and transitive client-import boundary checks. The malformed historical bootstrap still prevents claiming a complete real-database policy suite for every tenant table.

## Deployment and acceptance

No shared database migration, environment-variable change, webhook provisioning, live payment activation, or subscription activation is included. GLOW-23 preview tables and webhook setup remain external acceptance gates; production checkout remains disabled. These issues remain open until their full acceptance criteria, merge and deployment checks are satisfied.

The next ready coding work should inspect GLOW-42 marketplace-to-booking links and GLOW-28 multilingual templates. GLOW-53 pricing remains a product decision.

## Preview configuration inspection

Vercel project settings were inspected read-only. NEXT_PUBLIC_SUPABASE_URL is https://rfwhqutkiztxkagbhevp.supabase.co for all environments. Preview sandbox onboarding is true and its account ID matches acct_1UCiSZDNDjGEQe6f; the restricted key is stored as a Secret and was not revealed. The preview GLOWFLOW_APP_URL still points to the older feat-glow-23 onboarding branch, not this wave. GLOWFLOW_STRIPE_SANDBOX_DEPOSITS and STRIPE_SANDBOX_WEBHOOK_SECRET are absent. Update only a designated protected preview after preparing its stable origin and matching sandbox endpoint.

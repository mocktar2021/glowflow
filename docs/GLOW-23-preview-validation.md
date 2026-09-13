# GLOW-23 sandbox preview validation

This candidate provides an owner-only sandbox simulation. It does not enable real customer deposits or complete GLOW-23. Existing public booking behavior remains separate. Sandbox reservations do not appear in the salon calendar and cannot prevent real bookings.

## Prepared configuration

Keep production settings unchanged. On one protected Vercel preview only, provision:

- `VERCEL_ENV=preview` (Vercel-provided).
- `GLOWFLOW_STRIPE_SANDBOX_DEPOSITS=true` and `GLOWFLOW_STRIPE_SANDBOX_ONBOARDING=true`.
- `STRIPE_SANDBOX_ACCOUNT_ID=acct_1UCiSZDNDjGEQe6f`.
- A dedicated restricted `rk_test_` key stored as a sensitive environment variable.
- `NEXT_PUBLIC_SUPABASE_URL=https://rfwhqutkiztxkagbhevp.supabase.co` and the matching server credential, provisioned securely.
- `GLOWFLOW_APP_URL` equal to the exact HTTPS preview origin.
- `STRIPE_SANDBOX_WEBHOOK_SECRET` matching a dedicated sandbox connected-account endpoint at `/api/stripe/webhook` on that same preview.
- Keep `NEXT_PUBLIC_PAYMENTS_ENABLED=false`; this public flag does not authorize sandbox or live payments.

The key needs existing platform/account read and merchant capability access, plus connected-account Checkout Session creation. Validate actual restricted-key permission requirements from Stripe request logs without printing credentials or raw errors. Do not broaden to an unrestricted key. Configure supported payment methods to match the salon market. Enable `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired` on the sandbox endpoint.

Migration is prepared in source only until execution is explicitly recorded. First confirm the deployment's Supabase URL, project reference and organization match. Existing remote migration version numbers differ from repository filenames; reconcile history before applying anything. The repository's legacy schema bootstrap needs separate repair; the local test harness uses isolated prerequisites and runs the new migration itself.

## Test flow

1. Sign in as the salon owner on the protected preview. The payments page offers the deposit test only when both configuration and merchant readiness permit it.
2. Use fictitious contact information on `/{locale}/book/{salonSlug}?sandbox=1`. Staff, anonymous users and other salon owners must be denied.
3. Reserve an available service/time; complete Stripe Checkout with sandbox test data. The return page must initially show pending verification and show paid only after a signed webhook changes stored state.
4. Exercise failed, abandoned, expired, retried and delayed payments. Reload the return page and verify stored status. A late success or a lost live time slot requires reconciliation; no refund or real appointment is automatically created.
5. Repeat in French, English and Spanish. Verify production and disabled-preview checkout fail closed.

No protected-preview browser payment, real restricted-key Checkout call, deployed webhook delivery or shared-database migration is claimed by local/mock tests. These remain external acceptance gates. Public-customer payment activation and the broader ready Jira backlog remain unfinished after this sandbox candidate.

## Shared database application — 2026-09-13 UTC

The owner explicitly approved `add_stripe_sandbox_reservations`; it was applied to `rfwhqutkiztxkagbhevp` as remote migration `20260913000239`. Only the reviewed sandbox migration was executed. Postchecks verified RLS on both tables, owner-only reservation SELECT, hidden event rows, no client writes, service-only RPC execution with empty search paths, two GiST exclusion constraints and four foreign keys. Both new tables were empty after application. Source migration SHA256: D3A152AB26ADD266AE5F68D9BC5D9F4539DC6BC1FB6E306662842DE4F471F47A.

`codex/GLOW-23-sandbox-validation` is the dedicated branch for sandbox environment configuration and signed-webhook delivery verification. Production payments remain disabled. End-to-end Stripe validation is pending configuration and successful webhook reachability through Vercel deployment protection.

## Preview configuration preparation — pending

The dedicated preview is READY at `https://glowflow-git-codex-glow-23-388b27-tairoumocktar-9966s-projects.vercel.app` (initial deployment `dpl_FG7WizgRzeQfM3R3SubJ9XxKAU8J`). Configure overrides only for branch `codex/GLOW-23-sandbox-validation`:

- `GLOWFLOW_APP_URL`: the exact branch origin above.
- `STRIPE_SANDBOX_WEBHOOK_SECRET`: sensitive secret returned by the dedicated sandbox webhook creation; not yet created.
- `GLOWFLOW_STRIPE_SANDBOX_DEPOSITS=true`: enable only after the webhook secret and delivery path are configured.

Inherit the existing preview-only restricted key, sandbox account ID and onboarding flag. Keep production values unchanged. No environment variables have been changed by this preparation.

Webhook request: Stripe context `acct_1UCiSZDNDjGEQe6f`, test mode, `connect=true`, API version `2026-07-29.dahlia`, endpoint `/api/stripe/webhook` on the branch origin, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`. Connected-account events are required because deposits use direct charges on salon accounts. Automatic approval review rejected creation pending explicit authorization for connected-account event scope. No endpoint or signing secret was created.

Vercel browser controls timed out in the in-app browser and Chrome; CLI authentication is not configured locally. Environment saving remains blocked until browser access recovers. Vercel deployment protection also needs an approved delivery path for Stripe; do not disable preview authentication globally or place bypass credentials in source or public documentation.

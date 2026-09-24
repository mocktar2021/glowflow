# GlowFlow

GlowFlow is a multilingual salon operations scaffold for independent hair stylists, nail artists, and salon owners.

## Included

- French, English, and Spanish routes powered by `next-intl`
- Responsive dashboard with appointments, revenue, deposits, and walk-in queue
- Client drawer with color formulas, allergy history, and nail preferences
- Mobile-first public booking flow with a deposit summary
- Supabase browser, server, and session-refresh clients
- PostgreSQL schema with tenant-scoped RLS policies
- Multi-country market registry for France, the United States, and Spain
- Public salon discovery with owner-controlled listings and indexed search
- Stripe Connect direct-charge Checkout endpoint and signed webhook endpoint
- Light and dark color systems

## Routes

- `/{locale}/dashboard`
- `/{locale}/book/{salon-slug}`
- `/{locale}/salons`
- `/{locale}/salons/{salon-slug}`
- `/{locale}/dashboard/public-profile`
- `/api/checkout`
- `/api/preferences/locale`
- `/api/stripe/webhook`

Supported locales are `fr`, `en`, and `es`. Language preferences stay separate from salon operating countries. Active launch markets are configured in `public.markets`. The root route redirects to `/fr/dashboard`.

## Local setup

1. Copy `.env.example` to `.env.local` and add your sandbox values.
2. For a fresh project, run the historical baseline `supabase/schema.sql`, then **every** file in `supabase/migrations` in timestamp order. The baseline alone is not the current schema. For an existing project, reconcile its migration history before applying only pending migrations; never replay the baseline against an existing database.
3. Set each salon's Stripe connected account ID in `tenants.stripe_account_id` from trusted server code.
4. Keep `NEXT_PUBLIC_PAYMENTS_ENABLED=false` for the interactive deposit preview. Change it to `true` after the Supabase and Stripe sandbox setup works.
5. Run `npm run dev`.

Use a Supabase publishable key in the browser and a Supabase secret key only on the server. Use a restricted Stripe key and keep the webhook signing secret server-side.

## Deployment

- Hosting target: Vercel
- Database and authentication: a dedicated Supabase project in `us-east-1`
- Production URL: `https://glowflow.mocktar.com`
- Production branch: `master`
- Pull requests must pass lint, build, and route tests before merge.

Keep `NEXT_PUBLIC_PAYMENTS_ENABLED=false` until Stripe Connect sandbox onboarding and signed webhooks pass end-to-end verification.

## Payment model

GlowFlow uses Stripe Connect direct charges. Each salon stays the merchant of record. The Checkout endpoint reads service price and deposit values from Supabase, creates the payment on the connected account, without a GlowFlow application fee. Salons pay Stripe processing fees separately. Webhook events must drive final payment state changes.

Before enabling tax calculation, confirm the liable entity and active Stripe Tax registrations with a qualified tax adviser. The invoice schema stores TVA amounts but does not assume a legal rate.


## Launch revenue model

The approved model is a monthly subscription per salon, with tiers based on team size and defined messaging allowances. No GlowFlow commission applies to bookings or deposits. The legacy GLOWFLOW_PLATFORM_FEE_BPS variable is ignored and may be removed from deployment settings.

Subscription billing and exact country-specific prices are not implemented or activated by this change. GLOW-53 tracks pricing validation, entitlements, and messaging usage. GLOW-23 continues to track Connect onboarding and verified deposit collection.

## Sandbox salon onboarding (GLOW-23)

Owners open `/{locale}/dashboard/payments` from the dashboard Payments link.
The first delivery uses Stripe-hosted Accounts v2 onboarding with full dashboard access,
Stripe fee collection, and Stripe negative-balance responsibility. A fresh capability
read determines readiness. Returning from onboarding never marks the account ready.

Apply `20260906161330_add_stripe_sandbox_connections.sql` before enabling this flow,
including on a fresh installation. The table stores test mappings separately from
`tenants.stripe_account_id`, with owner-only reads and server-only writes.
No existing payment destinations are modified or backfilled.

For the selected test deployment, configure sensitive `STRIPE_RESTRICTED_KEY` with a
restricted key from GlowFlow sandbox. Set `STRIPE_SANDBOX_ACCOUNT_ID` to
`acct_1UCiSZDNDjGEQe6f`, `GLOWFLOW_APP_URL` to that deployment's HTTPS origin, and
`GLOWFLOW_STRIPE_SANDBOX_ONBOARDING=true`. The server rejects live or unrestricted keys
and verifies the actual platform account before creating or reading Stripe accounts.
Keep `NEXT_PUBLIC_PAYMENTS_ENABLED=false`.

Required key operations: retrieve the current platform account, create/retrieve Accounts v2
and create Accounts v2 account links. Validate these permissions in the sandbox before activation.
The key belongs only in the deployment's sensitive environment variables, never in a PR or chat.

Creation retries reuse one idempotency key per tenant. Pending mappings older than 23 hours
require operator reconciliation: locate the account by tenant metadata in the dedicated sandbox
and restore its mapping through trusted server access. Do not blindly retry creation or delete
the mapping after Stripe's idempotency retention window.

Verification before removing draft status: apply the migration, configure the test deployment,
sign in as an owner, complete hosted onboarding with test data, return and confirm the capability
status, retry an expired link, and verify staff/cross-tenant denial. No live account activation
or customer charges are part of this delivery. Embedded notification banners and account management,
deposit reservation/checkout correlation, and idempotent payment webhooks remain GLOW-23 follow-up work.

Rollback: disable `GLOWFLOW_STRIPE_SANDBOX_ONBOARDING`. Preserve account mappings once any
onboarding has occurred. Dropping the table is safe only before accounts have been created.

## Public salon media

The `salon-public-media` Supabase Storage bucket accepts owner uploads under `{tenant_id}/...`. Public profiles only render owner-selected URLs after the profile is published.

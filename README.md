# GlowFlow

GlowFlow is a multilingual salon operations scaffold for independent hair stylists, nail artists, and salon owners.

## Included

- French, English, and Spanish routes powered by `next-intl`
- Responsive dashboard with appointments, revenue, deposits, and walk-in queue
- Client drawer with color formulas, allergy history, and nail preferences
- Mobile-first public booking flow with a deposit summary
- Supabase browser, server, and session-refresh clients
- PostgreSQL schema with tenant-scoped RLS policies
- Stripe Connect direct-charge Checkout endpoint and signed webhook endpoint
- Light and dark color systems

## Routes

- `/{locale}/dashboard`
- `/{locale}/book/{salon-slug}`
- `/api/checkout`
- `/api/preferences/locale`
- `/api/stripe/webhook`

Supported locales are `fr`, `en`, and `es`. The root route redirects to `/fr/dashboard`.

## Local setup

1. Copy `.env.example` to `.env.local` and add your sandbox values.
2. Run `supabase/schema.sql` in a fresh Supabase project.
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

GlowFlow uses Stripe Connect direct charges. Each salon stays the merchant of record. The Checkout endpoint reads service price and deposit values from Supabase, creates the payment on the connected account, and retains the configured platform fee. Webhook events must drive final payment state changes.

Before enabling tax calculation, confirm the liable entity and active Stripe Tax registrations with a qualified tax adviser. The invoice schema stores TVA amounts but does not assume a legal rate.

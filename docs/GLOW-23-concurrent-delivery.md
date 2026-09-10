# GLOW-23 concurrent delivery — 2026-09-10

Base: `8719ed51aefb4b26106827ba287a46285d9e7d96` (`master`). GitHub open PR query returned none. Supabase project `rfwhqutkiztxkagbhevp`, organization `goutxcrujaxjjssbjfsn`, ACTIVE_HEALTHY; Vercel project/team match handover and latest deployment is READY `dpl_AGoNCCFAaWppRQQBmFLyjYW99Qcn`. Dedicated Stripe context `acct_1UCiSZDNDjGEQe6f` is test mode. Deployment environment values and webhook endpoint configuration remain unverified. Remote migration timestamps differ from repository filenames; do not blindly replay the migration directory.

## Scope and contract

This first wave implements an owner-authenticated, preview-only sandbox booking simulation. Sandbox reservation/client/appointment identifiers are isolated from real clients and appointments. Real customer deposit activation remains a later acceptance gate for GLOW-23. No live flags, migrations, charges, messages, or subscriptions are authorized by this implementation.

Money is an integer number of minor units from immutable trusted service/market snapshots. Each reservation has generated sandbox client/appointment IDs, tenant ID, connected sandbox account, service/staff, times, and a 35-minute hold. Status: reserved, pending, paid, failed, expired, reconciliation_required. Database exclusion constraints protect competing sandbox holds. Sandbox tests never block real bookings; live availability is checked on creation and settlement. Signed paid events can settle a valid hold; success after release or lost live capacity requires reconciliation. No automatic refund or slot reacquisition. Duplicate events are applied transactionally and paid is monotonic.

Checkout request mirrors public-booking fields, accepts no amount or account override, and uses one request key for retries. Return parameters only identify a reservation; authenticated server state drives the UI. Gates: explicit sandbox deposit flag, Vercel preview, dedicated restricted test key/platform account and exact GlowFlow Supabase URL. Production payment activation remains disabled.

Worker ownership: database owns migration/SQL tests; checkout owns checkout route and stripe-deposits helpers/tests; webhook owns webhook route and stripe-deposit-events helper/tests; coordinator owns booking UI, environment documentation, integration and review.

## Current non-Done Jira inventory

No issue has been marked Done by this run. Status reflects Jira, not a claim about code completeness. Issue links are empty in this query; dependencies below are inferred from acceptance criteria and require implementation verification.

| Issue | Jira status | Summary |
|---|---|---|
| GLOW-1 | In Progress | Platform Foundation, Authentication, and Deployment |
| GLOW-2 | Backlog | Client CRM, Formula Ledger, and Service Catalog |
| GLOW-3 | Backlog | Public Booking Portal and Deposit Protection |
| GLOW-4 | Backlog | Multilingual Reminders and Client Communications |
| GLOW-5 | Backlog | Smart Calendar, Availability, and Walk-In Queue |
| GLOW-6 | Backlog | Express Checkout, Payments, Invoices, and Analytics |
| GLOW-7 | Backlog | Security, Quality, Operations, and Launch Readiness |
| GLOW-8 | In Progress | Publish the validated GlowFlow scaffold to GitHub |
| GLOW-9 | Backlog | Implement email and password authentication with tenant onboarding |
| GLOW-10 | Selected for Development | Configure glowflow.mocktar.com and verify the production release |
| GLOW-11 | In Progress | Provision Supabase and apply the tenant database schema |
| GLOW-12 | In Progress | Add continuous integration quality checks |
| GLOW-13 | In Progress | Configure Vercel Preview and Production environments |
| GLOW-14 | Backlog | Record nail preferences, shades, designs, and infill history |
| GLOW-15 | Backlog | Record hair formulas, processing details, and patch tests |
| GLOW-16 | Backlog | Build the tenant-scoped client directory and profiles |
| GLOW-23 | In Progress | Onboard salons to Stripe Connect and collect deposits |
| GLOW-24 | Backlog | Implement cancellation, refund, and no-show policies |
| GLOW-25 | Backlog | Build the localized public booking portal |
| GLOW-26 | Backlog | Integrate WhatsApp and SMS delivery with retry controls |
| GLOW-27 | Backlog | Schedule appointment confirmations and reminders |
| GLOW-28 | Backlog | Create multilingual notification templates and locale rules |
| GLOW-29 | Backlog | Manage communication consent, opt-out, and history |
| GLOW-30 | Backlog | Build express checkout with services, add-ons, tips, and discounts |
| GLOW-31 | Backlog | Generate receipts and French TVA invoice records |
| GLOW-32 | Backlog | Record cash, card, and mixed payments |
| GLOW-33 | Backlog | Build daily revenue, deposit, tip, and payment analytics |
| GLOW-34 | Backlog | Add production observability for errors, webhooks, and jobs |
| GLOW-35 | Backlog | Add end-to-end tests for booking, deposits, and checkout |
| GLOW-36 | Backlog | Complete privacy, terms, support, backup, and launch checklist |
| GLOW-37 | Backlog | Automate Row Level Security and role authorization tests |
| GLOW-38 | In Progress | Multi-Country Salon Marketplace and Growth Website |
| GLOW-39 | Backlog | Add salon product catalog to public profiles |
| GLOW-42 | Backlog | Connect marketplace discovery to appointment booking |
| GLOW-44 | Backlog | Redesign the GlowFlow landing page for conversion |
| GLOW-45 | Backlog | Add GlowFlow favicon and application icons |
| GLOW-46 | Backlog | Design marketplace search results and country pages |
| GLOW-48 | Backlog | Enable leaked-password protection after Supabase Pro upgrade |
| GLOW-53 | Backlog | Define and implement salon subscription plans and messaging allowances |

## Subsequent wave candidates and blockers

GLOW-25/42 depend on integrated booking and authoritative payment responses; GLOW-35/37 can extend verification alongside those flows. GLOW-24/30/31/32/33 require lifecycle and financial policy work after GLOW-23. GLOW-14/15/16 and GLOW-39 require existing CRM/catalog inspection before assignment. GLOW-28 can precede provider integration; GLOW-26/27/29 depend on delivery credentials and consent rules. GLOW-44/45/46 require current UI implementation checks. GLOW-53 requires approved pricing/allowances and cannot enable paid plans. GLOW-48 requires the recorded Supabase plan upgrade. Foundation issues GLOW-8–13 need current deployment/acceptance evidence before closure. Epics remain open until child acceptance is verified.


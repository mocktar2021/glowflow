# GLOW-53 subscription contract, code-only foundation

This is an inert plan-selection contract, not a billing launch. There is no
shipped plan catalog, Stripe Product/Price, subscription Checkout route, portal,
webhook, subscription schema, entitlement enforcement, or environment switch.
The existing owner-only Stripe sandbox checkout remains a separate client
deposit flow on a salon connected account. GlowFlow subscription charges must
run on the platform account and never collect a booking commission.

`lib/billing/subscription-contract.ts` accepts only a `planKey` from a future
browser request. A future server route must load the salon country, currency,
and active team count from trusted tenant records and select a reviewed Price
ID from its own nonempty catalog. Unknown fields, duplicate price mappings,
market mismatches, and seat counts above the selected limit fail closed. The
catalog contains no amounts: Stripe Prices, country-specific amounts, larger-team
thresholds, message allowances, and any overage policy still need product-owner
approval. No code currently calls the contract, so it cannot activate billing.

## Owner-approved Starter offer

- One month free, with a payment method collected at signup and automatic
  monthly billing after the trial. The trial ends on the same calendar date in
  the following month, not after a fixed 30 days. When that date does not exist
  next month (for example, January 31), use the last day of the next month.
- Starter costs USD 19.99 per month for US salons, or EUR 14.99 per month for
  salons in exactly France, Spain, Belgium, and Luxembourg. Both displayed
  prices are before applicable tax. Larger-team prices are not approved.
- `lib/billing/starter-offer.ts` records only those five country/price pairs,
  the three-person cap, and the one-calendar-month trial/month-end rule. Unsupported
  markets return no offer. This pure module is not connected to Checkout,
  Stripe Prices, tax calculation, or any production route.
- Starter permits one owner plus two active staff, three active people total.
  The owner counts toward the limit. Pending invitation treatment still needs
  a rule before the team-size read model is implemented.
- This document records product decisions only. It does not define Stripe
  Prices, create a catalog, calculate trial timestamps, or enable billing.

## Required decisions before a billing implementation

1. Define larger-team tiers and prices, and how pending invitations reserve or
   do not reserve Starter seats.
2. Define included SMS/WhatsApp quantities and whether excess usage is blocked,
   prepaid, or billed. Do not assume metered billing or new paid tooling.
3. Define authoritative trial time-zone behavior, trial-ending
   notice, failed-payment grace period, downgrade/cancellation timing, service
   access during nonpayment, refunds, and support ownership.
4. Determine the platform subscription seller, tax registrations, tax treatment,
   invoice requirements, and applicable country-specific policy. The owner
   reports adviser confirmation for North Carolina sales tax, but EU VAT
   applicability is unknown and no registration is present. Do not enable
   Stripe Tax merely by adding `automatic_tax`: it collects only where an active
   registration exists and must be verified with a test calculation.

## Subsequent reviewed slices

- Add tenant-scoped subscription state, server-only plan/price configuration,
  and an idempotent billing-event ledger with owner-read-only RLS. A migration
  file and hosted application need separate review and approval.
- Add owner-only subscription Checkout and Customer Portal routes. Use Stripe
  Billing, a restricted platform key, a trusted Price ID, and no connected-salon
  `stripeAccount` option or browser-supplied amount/Price ID. Keep release
  activation disabled until pricing and operational gates are approved.
- Add a separate signed platform webhook that reconciles subscription lifecycle,
  paid/failed invoices, disputes, refunds, and early-fraud warnings. Never infer
  active service from the Checkout success redirect alone.
- Add FR/EN/ES management UI and isolated tenant, retry, out-of-order event,
  failure, cancellation, tax, and grace-period tests before a controlled launch.

No Stripe, Supabase, Vercel, billing, or customer state changes were made by
this contract.

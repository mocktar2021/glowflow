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
future selector catalog maps reviewed Stripe Price IDs, not browser-supplied
amounts. Approved Starter amounts are recorded separately below; larger-team
thresholds and prices, message allowances, and any overage policy still need
product-owner approval. No code currently calls the contract, so it cannot
activate billing.

`lib/billing/starter-checkout-preflight.ts` is another inert server-only
contract. It compares a future retrieved Stripe Price to the exact approved
Starter amount and currency for the salon market, an explicitly configured
Price ID, the expected sandbox/live mode, a one-month licensed recurring
interval, and exclusive tax behavior. It rejects inactive, underpriced,
inclusive-tax, wrong-mode, annual, or metered Prices. It also calculates the
approved *local calendar date* one month after signup, clamping missing dates
to month-end, including leap years. It deliberately does not turn that date
into Stripe's UTC `trial_end`: the authoritative billing time zone has not yet
been approved. Price evidence is not proof that a Product has the right tax
code, that Stripe Tax is ready, or that a subscription may be created. No
route calls this module, no Stripe Price is configured, and no hosted state
changes from it.

## Owner-approved Starter offer

- One month free, with a payment method collected at signup and automatic
  monthly billing after the trial. The trial ends on the same calendar date in
  the following month, not after a fixed 30 days. When that date does not exist
  next month (for example, January 31), use the last day of the next month.
- Starter costs USD 29.99 per month for US salons, or EUR 24.99 per month for
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
4. Determine the platform subscription seller, tax registrations, invoice
   requirements, and applicable country-specific policy. The owner reports
   confirmation for North Carolina sales tax and intends reverse charge for
   eligible EU business salons in France, Spain, Belgium, and Luxembourg. This
   does not establish that every salon qualifies or settle seller establishment,
   registration/OSS, or sales without a valid business VAT ID. Do not enable
   Stripe Tax merely by adding `automatic_tax`: it collects only where an active
   registration exists and must be verified with a sandbox calculation,
   including the taxability reason. Stripe Tax and automated filing may carry
   fees, so verify pricing and obtain the owner's cost approval before enabling
   either. The live and sandbox GlowFlow Stripe accounts were read-only checked
   on 9 November 2026: both Tax Settings were `pending` without a head-office
   address, and both had zero tax registrations, Products, and Prices.
5. Before creating Stripe Products or Prices, confirm the correct product tax
   code against the actual subscription delivery model and set the monthly
   Prices to exclusive tax behavior, matching the displayed before-tax amounts.
   A read-only [Stripe Tax Codes search](https://docs.stripe.com/tax/tax-codes)
   returned `txcd_10103001`, SaaS for business use without a software download,
   as a candidate for the current web subscription. This is not a legal
   classification or an approved live Product; the owner must confirm the
   product description before it is used. Collect the buyer's trusted billing
   location, independently of the salon operating country, and, for EU
   business treatment, its VAT ID. Stripe
   [verifies EU VAT IDs with VIES asynchronously](https://docs.stripe.com/billing/customer/tax-ids),
   but [Stripe Tax can apply reverse charge based on the ID's format even when
   government verification is pending or unsuccessful](https://docs.stripe.com/tax/invoicing/tax-ids).
   A future EU paid Checkout route must retrieve Stripe's tax-ID status and
   require `verified` before applying GlowFlow's stricter reverse-charge path;
   `pending`, `unverified`, `unavailable`, a missing ID, and duplicate
   billing-country IDs fail closed. `lib/billing/eu-vat-evidence.ts` supplies
   that inert server-side guard. Review name/address correspondence where VIES
   returns it; Stripe does
   not do that match for GlowFlow. Sandbox tax calculations must report
   `taxability_reason: reverse_charge`; a zero amount or `not_collecting` is not
   evidence of correct treatment. Neither this guard nor the owner's intended
   reverse-charge policy determines legal eligibility for every sale.
6. Review trial and automatic-renewal disclosures, a pre-charge reminder,
   accessible cancellation, and the invoice/receipt format for each market.
   Stripe Billing and Checkout can support these flows, but Stripe does not
   decide GlowFlow's legal tax obligations or eliminate required registrations.

## Subsequent reviewed slices

- Add tenant-scoped subscription state, server-only plan/price configuration,
  and an idempotent billing-event ledger with owner-read-only RLS. A migration
  file and hosted application need separate review and approval.
- Add owner-only subscription Checkout and Customer Portal routes. Use Stripe
  Billing, a restricted platform key, a trusted Price ID, and no connected-salon
  `stripeAccount` option or browser-supplied amount/Price ID. The planned
  calendar-month trial needs an explicit `trial_end` timestamp rather than a
  fixed 30-day trial. Keep release activation disabled until pricing and
  operational gates are approved.
- Add a separate signed platform webhook that reconciles subscription lifecycle,
  paid/failed invoices, disputes, refunds, and early-fraud warnings. Never infer
  active service from the Checkout success redirect alone.
- Add FR/EN/ES management UI and isolated tenant, retry, out-of-order event,
  failure, cancellation, tax, and grace-period tests before a controlled launch.

No Stripe, Supabase, Vercel, billing, or customer state changes were made by
this contract.

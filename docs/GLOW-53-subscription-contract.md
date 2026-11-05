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
catalog contains no amounts: Stripe Prices, country-specific amounts, team
thresholds, message allowances, and any overage policy still need product-owner
approval. No code currently calls the contract, so it cannot activate billing.

## Required decisions before a billing implementation

1. Approve launch markets, monthly tier names and prices by currency, and how
   accepted staff, pending invitations, and owners count toward team size.
2. Define included SMS/WhatsApp quantities and whether excess usage is blocked,
   prepaid, or billed. Do not assume metered billing or new paid tooling.
3. Define trial, failed-payment grace period, downgrade/cancellation timing,
   service access during nonpayment, refunds, and support ownership.
4. Determine the platform subscription seller, tax registrations, tax treatment,
   invoice requirements, and applicable country-specific policy. Do not enable
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

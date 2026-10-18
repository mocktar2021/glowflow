# GLOW-30 checkout totals groundwork

`calculateCheckoutQuote` is pure arithmetic over integer minor units. It is not
connected to the UI, database, or Stripe, and it does not charge or close an
appointment. The appointment amount must come from the immutable service price
snapshot. Add-on amounts must come from approved server-side records, not a
browser-supplied price. Existing payments, including deposits, must come from
the ledger; refunds reduce the net paid amount.

The caller must supply an explicitly resolved tax amount and an approved
discount amount. There is no inferred tax rate, tax-exempt status, discount
eligibility, or zero-tax default. An unresolved tax input yields no total or
balance due. A resolved quote is arithmetic only, not permission to collect a
payment. The currency must match on every priced input.

## Remaining acceptance gaps

- Appointment and deposit loading: the existing trusted service snapshot and
  payment summary are available, but no express checkout screen loads them.
- Approved services and add-ons: no checkout line-item source or validation
  policy is connected. Service changes after booking are not modeled.
- Tips, discounts, taxes, totals: the arithmetic is covered here; rules for
  discount authority and calculation, taxable base, jurisdiction, rounding,
  exemptions, and applicable tax source remain product and compliance decisions.
- Atomic completion: there is no operation that records checkout line items,
  an invoice, final tender allocation, and appointment completion in one
  transaction. This needs a schema and server-side transaction design before
  any checkout UI can claim completion. The existing payment ledger alone is
  not an invoice or a completed checkout.

No hosted migration, production setting, or real payment should be changed for
this groundwork. GLOW-30 should remain open until the above gaps are resolved.

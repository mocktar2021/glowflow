# GLOW-31 draft sales-document contract

This is an implementation inventory, **not a receipt or invoice specification approved for use**. No document is issued, numbered, rendered, stored, or sent by this change. The dormant `inspectSalesDocumentEvidence` helper reports only gap codes and always includes `issuance_policy_unapproved`. Its empty-field checks do not validate identities, arithmetic, tax treatment, or legal compliance.

## Current source-backed state

| Source | What it provides | What it does not establish |
| --- | --- | --- |
| `supabase/schema.sql`, `public.invoices` | Tenant-scoped unique `(tenant_id, invoice_number)`, total, currency, status, and a TVA amount column | Sequential number allocation; immutable seller/client/line/tax/payment snapshots; approved issuance, correction, retention, or country policy. The current `tva_tax_amount DEFAULT 0` must **not** be interpreted as a resolved zero-tax decision. |
| Appointment service snapshots in `20260925194709_add_trusted_appointment_payment_recording.sql` | Captured service title, price, deposit, and currency at booking time | Invoice line allocation, discounts, tips, tax treatment, buyer/seller details, or a document number. |
| Append-only `payment_entries` in `20260925143324_add_immutable_payment_ledger.sql` | Tenant-scoped payment/refund history, methods, currency, and idempotency | A paid invoice, receipt issuance, refund document, tax determination, or a legally complete payment statement. |
| `lib/payments/checkout-totals.ts` | Minor-unit quote arithmetic with an explicit `tax_unresolved` state | Tax rate selection, taxable basis, legal invoice totals, or a payment authorization. |
| `lib/markets.ts` | Separate country, locale, currency, time zone, and tax label/mode | A French TVA rate, exemption rule, registration, seller-of-record decision, or country-specific issuance rules. |

The schema snapshot is local repository evidence only; this change did not query or alter hosted Supabase data.

## Draft data boundary for a future implementation

Before issuance, a future server-side transaction must snapshot the seller and client identities required by the applicable policy; each service/add-on line and its trusted price; document currency; explicit discounts and tips; the tax amount **and its reviewed treatment/basis**; the immutable ledger entries or an explicit unpaid state; and reconciled totals. Language (`fr`, `en`, `es`) is a presentation preference and must not substitute for the seller's operating country, currency, tax jurisdiction, or legal rules. A document should remain tied to its tenant and authoritative payment/appointment records, never to untrusted browser values.

The dormant evidence helper deliberately checks only whether minimal candidate fields are present and internally currency-shaped. It requires explicit nonnegative minor-unit discount and tip snapshots, including documented zeros, so absent adjustments cannot be mistaken for zero. It never accepts or produces an invoice number, calculates tax, reconciles line totals or ledger entries, marks a document as paid, or returns an issuance-ready/compliance flag. A documented zero tax amount still needs an explicit basis string, but that string is **not** verified as legally correct. No caller currently uses this helper.

## Decisions required before any issuing code or migration

1. Legal/tax review per operating country: who is the seller and tax-liable entity; required business and buyer identifiers/addresses; taxable basis for services, products, discounts, tips, deposits, and mixed tender; exemption and zero-rate wording; currency precision; correction/credit-note and refund treatment; retention and delivery requirements. Do not assume a universal French TVA rate or enable Stripe Tax without confirmed registrations.
2. Product policy: when a receipt versus invoice is required; whether booking, deposit, each payment, completion, or refund triggers a document; whether an unpaid document exists; how owner-initiated corrections work; and which language to use when the buyer and salon preferences differ.
3. Numbering policy: tenant scope, sequence format, reset periods, gap handling, canceled/void numbers, concurrency, and whether each document type has a separate sequence. The existing unique constraint prevents duplicates but does not allocate a sequential number.
4. Data/security design: immutable issued snapshots, transactionally allocated numbers, audit/correction records, owner/staff/client read permissions and RLS, private download authorization, idempotent issuance events, backfill policy for existing invoices, and a reversible migration plan. Existing rows must not silently acquire inferred TVA or invented numbers.
5. Presentation validation: legal-approved French, English, and Spanish content; localized date/money output with the correct currency exponent; print/download accessibility; and tests for cross-tenant access, concurrency, retries, refunds, and historical catalog changes.

Until these decisions are recorded and tested, GLOW-31 remains incomplete. A future implementation must not infer `tax = 0` from a missing tax result, treat a Stripe payment as an invoice, or use the existing `invoices` table as evidence of compliance.

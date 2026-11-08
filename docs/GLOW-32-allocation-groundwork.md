# GLOW-32 tender allocation groundwork

`validateTenderProposal` is pure arithmetic over a resolved GLOW-30 checkout
quote. It confirms that proposed cash and externally processed card amounts
exactly equal the quote's outstanding balance after prior ledger payments and
refunds. A zero balance requires no new tender. The output is a proposed split,
not evidence of payment, an invoice, a receipt, or appointment completion.

The quote must be derived server-side from trusted appointment prices and
approved adjustments. An unresolved tax quote is rejected. Prior ledger net
paid may include a deposit, but the current ledger does not classify it as one.
`external_card` means a card transaction the salon processed outside GlowFlow;
this module does not create a Stripe charge or assert provider settlement.

The existing owner-only manual payment operation records one cash or external
card entry at a time and protects each entry from overpayment. It does not
atomically persist a mixed split with an invoice and completed appointment.
The GLOW-30 quote is not an issued invoice, so balanced allocation against that
quote alone does not satisfy the story's invoice-equality completion criterion.

Before activating checkout, product and finance owners must settle invoice,
deposit, tax, receipt, and supported payment-method rules. Staff recording
permissions remain undecided. A reviewed transaction must then atomically
validate authoritative invoice totals, prior ledger entries, tender allocations,
and appointment completion with idempotency and concurrency protection. Cash
and card reporting/receipt lines must derive from those persisted records;
GLOW-33's daily ledger groundwork is not yet a released report. No hosted
schema change, payment write, or live checkout is included here. GLOW-32 stays
In Progress.

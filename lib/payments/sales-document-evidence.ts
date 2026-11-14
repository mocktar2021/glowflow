/**
 * Draft-only inventory of evidence gaps for GLOW-31. This module never issues,
 * numbers, renders, stores, or certifies an invoice or receipt.
 */
export type SalesDocumentEvidenceGap =
  | "issuance_policy_unapproved"
  | "seller_snapshot_missing"
  | "client_snapshot_missing"
  | "service_snapshot_missing"
  | "adjustment_snapshot_missing"
  | "currency_missing"
  | "payment_snapshot_missing"
  | "tax_evidence_missing"
  | "total_missing"
  | "payment_ledger_inconsistent";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function name(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function amount(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function currency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function safeSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function inspectSalesDocumentEvidence(input: unknown): {
  kind: "draft_evidence_gaps";
  gaps: SalesDocumentEvidenceGap[];
} {
  const candidate = record(input);
  const seller = record(candidate.seller);
  const client = record(candidate.client);
  const documentCurrency = candidate.currency;
  const services = candidate.services;
  const adjustments = record(candidate.adjustments);
  const payment = record(candidate.payment);
  const tax = record(candidate.tax);

  // This blocker is unconditional until numbering, issuance, corrections,
  // retention, and jurisdictional rules have a reviewed implementation.
  const gaps: SalesDocumentEvidenceGap[] = ["issuance_policy_unapproved"];
  if (!name(seller.name)) gaps.push("seller_snapshot_missing");
  if (!name(client.name)) gaps.push("client_snapshot_missing");
  if (!currency(documentCurrency)) gaps.push("currency_missing");
  if (!Array.isArray(services) || services.length === 0 || services.some((rawLine: unknown) => {
    const line = record(rawLine);
    return !name(line.description) || !amount(line.amountMinor)
      || !currency(line.currency) || line.currency !== documentCurrency;
  })) gaps.push("service_snapshot_missing");
  // Zero is a valid documented adjustment. An absent value is not evidence
  // that no discount or tip applied to the underlying sale.
  if (!amount(adjustments.discountMinor) || !amount(adjustments.tipMinor)
    || !currency(adjustments.currency) || adjustments.currency !== documentCurrency) {
    gaps.push("adjustment_snapshot_missing");
  }

  const entries = payment.entries;
  const paymentDocumented = (payment.status === "unpaid"
    && (entries == null || (Array.isArray(entries) && entries.length === 0))) ||
    (payment.status === "recorded" && Array.isArray(entries) && entries.length > 0
      && entries.every((rawEntry: unknown) => {
        const entry = record(rawEntry);
        return (entry.type === "payment" || entry.type === "refund")
          && (entry.method === "cash" || entry.method === "external_card" || entry.method === "stripe")
          && amount(entry.amountMinor) && entry.amountMinor !== 0
          && currency(entry.currency) && entry.currency === documentCurrency;
      }));
  if (!paymentDocumented) gaps.push("payment_snapshot_missing");

  if (tax.status !== "documented" || !amount(tax.amountMinor)
    || !currency(tax.currency) || tax.currency !== documentCurrency
    || !name(tax.basis)) gaps.push("tax_evidence_missing");
  if (!amount(candidate.totalMinor)) gaps.push("total_missing");

  // Refunds cannot exceed collected payments, regardless of future tax,
  // discount, tip, or change policy. This does not reconcile document totals.
  if (paymentDocumented && payment.status === "recorded") {
    const paymentEntries = entries as Record<string, unknown>[];
    const paid = safeSum(paymentEntries.filter((entry) => entry.type === "payment")
      .map((entry) => entry.amountMinor as number));
    const refunded = safeSum(paymentEntries.filter((entry) => entry.type === "refund")
      .map((entry) => entry.amountMinor as number));
    if (paid === null || refunded === null || refunded > paid) {
      gaps.push("payment_ledger_inconsistent");
    }
  }
  return { kind: "draft_evidence_gaps", gaps };
}

/**
 * Quote arithmetic only. Callers must obtain appointment and add-on amounts from
 * trusted server-side records, and resolve tax and discount policy separately.
 * This module does not authorize payment or complete an invoice.
 */
export type TrustedCheckoutLine = {
  amountMinor: number;
  currency: string;
};

export type CheckoutTax =
  | { status: "unresolved" }
  | { status: "resolved"; amountMinor: number; currency: string };

export type CheckoutQuoteInput = {
  appointment: TrustedCheckoutLine;
  addOns: readonly TrustedCheckoutLine[];
  discountMinor: number;
  tipMinor: number;
  paidMinor: number;
  refundedMinor: number;
  tax: CheckoutTax;
};

export type CheckoutQuote =
  | { status: "invalid"; reason: "invalid_amount" | "invalid_currency" | "currency_mismatch" | "amount_overflow" | "discount_exceeds_subtotal" | "refund_exceeds_payment" | "payment_exceeds_total" }
  | {
      status: "tax_unresolved";
      currency: string;
      subtotalMinor: number;
      discountMinor: number;
      tipMinor: number;
      netPaidMinor: number;
    }
  | {
      status: "ready";
      currency: string;
      subtotalMinor: number;
      discountMinor: number;
      taxMinor: number;
      tipMinor: number;
      totalMinor: number;
      netPaidMinor: number;
      balanceDueMinor: number;
    };

function validAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function checkedSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!validAmount(value)) return null;
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function calculateCheckoutQuote(input: CheckoutQuoteInput): CheckoutQuote {
  const currency = input.appointment.currency;
  if (!/^[A-Z]{3}$/.test(currency)) return { status: "invalid", reason: "invalid_currency" };

  const lines = [input.appointment, ...input.addOns];
  if (lines.some((line) => !/^[A-Z]{3}$/.test(line.currency))) {
    return { status: "invalid", reason: "invalid_currency" };
  }
  if (lines.some((line) => line.currency !== currency)) {
    return { status: "invalid", reason: "currency_mismatch" };
  }
  if (![input.discountMinor, input.tipMinor, input.paidMinor, input.refundedMinor].every(validAmount)
    || lines.some((line) => !validAmount(line.amountMinor))) {
    return { status: "invalid", reason: "invalid_amount" };
  }
  if (input.tax.status === "resolved") {
    if (!/^[A-Z]{3}$/.test(input.tax.currency)) return { status: "invalid", reason: "invalid_currency" };
    if (input.tax.currency !== currency) return { status: "invalid", reason: "currency_mismatch" };
    if (!validAmount(input.tax.amountMinor)) return { status: "invalid", reason: "invalid_amount" };
  }

  const subtotalMinor = checkedSum(lines.map((line) => line.amountMinor));
  if (subtotalMinor === null) return { status: "invalid", reason: "amount_overflow" };
  if (input.discountMinor > subtotalMinor) return { status: "invalid", reason: "discount_exceeds_subtotal" };
  if (input.refundedMinor > input.paidMinor) return { status: "invalid", reason: "refund_exceeds_payment" };
  const netPaidMinor = input.paidMinor - input.refundedMinor;

  if (input.tax.status === "unresolved") {
    return {
      status: "tax_unresolved", currency, subtotalMinor,
      discountMinor: input.discountMinor, tipMinor: input.tipMinor, netPaidMinor,
    };
  }

  const totalMinor = checkedSum([
    subtotalMinor - input.discountMinor, input.tax.amountMinor, input.tipMinor,
  ]);
  if (totalMinor === null) return { status: "invalid", reason: "amount_overflow" };
  if (netPaidMinor > totalMinor) return { status: "invalid", reason: "payment_exceeds_total" };

  return {
    status: "ready", currency, subtotalMinor, discountMinor: input.discountMinor,
    taxMinor: input.tax.amountMinor, tipMinor: input.tipMinor, totalMinor,
    netPaidMinor, balanceDueMinor: totalMinor - netPaidMinor,
  };
}

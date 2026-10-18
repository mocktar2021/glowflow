import type { CheckoutQuote } from "./checkout-totals";

/**
 * Arithmetic for a proposed in-salon tender split, not a payment result.
 * A caller must obtain the quote from trusted server-side amounts and the
 * prior paid/refunded ledger, then separately authorize and record each tender.
 * External card means a card processed outside GlowFlow, not a Stripe charge.
 */
export type TenderProposal = {
  currency: string;
  cashMinor: number;
  externalCardMinor: number;
};

export type AllocationPlan =
  | { status: "invalid"; reason: "quote_not_ready" | "invalid_currency" | "currency_mismatch" | "invalid_amount" | "inconsistent_quote" | "amount_overflow" | "allocation_mismatch" }
  | {
      status: "balanced";
      mode: "none" | "cash" | "external_card" | "mixed";
      currency: string;
      quoteTotalMinor: number;
      priorNetPaidMinor: number;
      balanceDueMinor: number;
      proposedCashMinor: number;
      proposedExternalCardMinor: number;
    };

function nonnegativeMinor(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateTenderProposal(
  quote: CheckoutQuote,
  proposal: TenderProposal,
): AllocationPlan {
  if (quote.status !== "ready") return { status: "invalid", reason: "quote_not_ready" };
  if (!/^[A-Z]{3}$/.test(quote.currency) || !/^[A-Z]{3}$/.test(proposal.currency)) {
    return { status: "invalid", reason: "invalid_currency" };
  }
  if (quote.currency !== proposal.currency) return { status: "invalid", reason: "currency_mismatch" };
  if (![quote.totalMinor, quote.netPaidMinor, quote.balanceDueMinor,
    proposal.cashMinor, proposal.externalCardMinor].every(nonnegativeMinor)) {
    return { status: "invalid", reason: "invalid_amount" };
  }
  const quotedSum = quote.netPaidMinor + quote.balanceDueMinor;
  if (!Number.isSafeInteger(quotedSum)) return { status: "invalid", reason: "amount_overflow" };
  if (quotedSum !== quote.totalMinor) return { status: "invalid", reason: "inconsistent_quote" };
  const proposedSum = proposal.cashMinor + proposal.externalCardMinor;
  if (!Number.isSafeInteger(proposedSum)) return { status: "invalid", reason: "amount_overflow" };
  if (proposedSum !== quote.balanceDueMinor) {
    return { status: "invalid", reason: "allocation_mismatch" };
  }

  const mode = proposal.cashMinor === 0
    ? proposal.externalCardMinor === 0 ? "none" : "external_card"
    : proposal.externalCardMinor === 0 ? "cash" : "mixed";
  return {
    status: "balanced", mode, currency: quote.currency,
    quoteTotalMinor: quote.totalMinor, priorNetPaidMinor: quote.netPaidMinor,
    balanceDueMinor: quote.balanceDueMinor,
    proposedCashMinor: proposal.cashMinor,
    proposedExternalCardMinor: proposal.externalCardMinor,
  };
}

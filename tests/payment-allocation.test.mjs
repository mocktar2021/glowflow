import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}
const { calculateCheckoutQuote } = await load("../lib/payments/checkout-totals.ts");
const { validateTenderProposal } = await load("../lib/payments/allocation.ts");

function quote(overrides = {}) {
  return calculateCheckoutQuote({
    appointment: { amountMinor: 4500, currency: "USD" }, addOns: [],
    discountMinor: 0, tipMinor: 0, paidMinor: 1500, refundedMinor: 0,
    tax: { status: "resolved", amountMinor: 0, currency: "USD" }, ...overrides,
  });
}
const proposal = (cashMinor, externalCardMinor, currency = "USD") => ({
  cashMinor, externalCardMinor, currency,
});

test("prior ledger payments reduce the amount allocated in cash", () => {
  assert.deepEqual(validateTenderProposal(quote(), proposal(3000, 0)), {
    status: "balanced", mode: "cash", currency: "USD",
    quoteTotalMinor: 4500, priorNetPaidMinor: 1500, balanceDueMinor: 3000,
    proposedCashMinor: 3000, proposedExternalCardMinor: 0,
  });
});

test("accepts external card only or a mixed proposal without charging a card", () => {
  assert.equal(validateTenderProposal(quote(), proposal(0, 3000)).mode, "external_card");
  assert.deepEqual(validateTenderProposal(quote(), proposal(1000, 2000)), {
    status: "balanced", mode: "mixed", currency: "USD",
    quoteTotalMinor: 4500, priorNetPaidMinor: 1500, balanceDueMinor: 3000,
    proposedCashMinor: 1000, proposedExternalCardMinor: 2000,
  });
});

test("prior refunds increase the balance to allocate", () => {
  const withRefund = quote({ refundedMinor: 500 });
  assert.equal(withRefund.balanceDueMinor, 3500);
  assert.equal(validateTenderProposal(withRefund, proposal(2000, 1500)).status, "balanced");
});

test("zero balance accepts no new tender only and does not imply completion", () => {
  const fullyCovered = quote({ paidMinor: 4500 });
  assert.deepEqual(validateTenderProposal(fullyCovered, proposal(0, 0)), {
    status: "balanced", mode: "none", currency: "USD",
    quoteTotalMinor: 4500, priorNetPaidMinor: 4500, balanceDueMinor: 0,
    proposedCashMinor: 0, proposedExternalCardMinor: 0,
  });
  assert.deepEqual(validateTenderProposal(fullyCovered, proposal(1, 0)), {
    status: "invalid", reason: "allocation_mismatch",
  });
});

test("rejects under and over allocation", () => {
  for (const amounts of [[1499, 1500], [1501, 1500], [0, 0], [3001, 0]]) {
    assert.deepEqual(validateTenderProposal(quote(), proposal(...amounts)), {
      status: "invalid", reason: "allocation_mismatch",
    });
  }
});

test("unresolved tax or an invalid quote cannot produce a tender plan", () => {
  const unresolved = quote({ tax: { status: "unresolved" } });
  assert.equal(unresolved.status, "tax_unresolved");
  assert.deepEqual(validateTenderProposal(unresolved, proposal(3000, 0)), {
    status: "invalid", reason: "quote_not_ready",
  });
  assert.deepEqual(validateTenderProposal({ status: "invalid", reason: "invalid_amount" }, proposal(3000, 0)), {
    status: "invalid", reason: "quote_not_ready",
  });
});

test("rejects cross-currency, malformed, unsafe, and inconsistent proposals", () => {
  assert.deepEqual(validateTenderProposal(quote(), proposal(3000, 0, "EUR")), {
    status: "invalid", reason: "currency_mismatch",
  });
  assert.deepEqual(validateTenderProposal(quote(), proposal(3000, 0, "usd")), {
    status: "invalid", reason: "invalid_currency",
  });
  for (const amount of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(validateTenderProposal(quote(), proposal(amount, 0)), {
      status: "invalid", reason: "invalid_amount",
    });
  }
  assert.deepEqual(validateTenderProposal(quote(), proposal(Number.MAX_SAFE_INTEGER, 1)), {
    status: "invalid", reason: "amount_overflow",
  });
  assert.deepEqual(validateTenderProposal({ ...quote(), balanceDueMinor: 2999 }, proposal(2999, 0)), {
    status: "invalid", reason: "inconsistent_quote",
  });
});

test("does not mutate the quote or proposed split", () => {
  const trustedQuote = Object.freeze(quote());
  const split = Object.freeze(proposal(1000, 2000));
  assert.equal(validateTenderProposal(trustedQuote, split).status, "balanced");
  assert.equal(split.cashMinor, 1000);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/payments/checkout-totals.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { calculateCheckoutQuote } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);

function input(overrides = {}) {
  return {
    appointment: { amountMinor: 4500, currency: "USD" },
    addOns: [{ amountMinor: 1000, currency: "USD" }],
    discountMinor: 500,
    tipMinor: 800,
    paidMinor: 1500,
    refundedMinor: 0,
    tax: { status: "resolved", amountMinor: 400, currency: "USD" },
    ...overrides,
  };
}

test("adds trusted line amounts and explicit adjustments in integer minor units", () => {
  assert.deepEqual(calculateCheckoutQuote(input()), {
    status: "ready", currency: "USD", subtotalMinor: 5500,
    discountMinor: 500, taxMinor: 400, tipMinor: 800,
    totalMinor: 6200, netPaidMinor: 1500, balanceDueMinor: 4700,
  });
});

test("prior deposits and refunds affect only the remaining balance", () => {
  const quote = calculateCheckoutQuote(input({ paidMinor: 2500, refundedMinor: 1000 }));
  assert.equal(quote.netPaidMinor, 1500);
  assert.equal(quote.balanceDueMinor, 4700);
});

test("unresolved tax cannot silently become zero or a payable total", () => {
  const quote = calculateCheckoutQuote(input({ tax: { status: "unresolved" } }));
  assert.deepEqual(quote, {
    status: "tax_unresolved", currency: "USD", subtotalMinor: 5500,
    discountMinor: 500, tipMinor: 800, netPaidMinor: 1500,
  });
  assert.equal("totalMinor" in quote, false);
  assert.equal("balanceDueMinor" in quote, false);
});

test("rejects mixed and malformed currencies", () => {
  assert.deepEqual(calculateCheckoutQuote(input({ addOns: [{ amountMinor: 100, currency: "EUR" }] })), { status: "invalid", reason: "currency_mismatch" });
  assert.deepEqual(calculateCheckoutQuote(input({ tax: { status: "resolved", amountMinor: 100, currency: "EUR" } })), { status: "invalid", reason: "currency_mismatch" });
  assert.deepEqual(calculateCheckoutQuote(input({ appointment: { amountMinor: 100, currency: "usd" } })), { status: "invalid", reason: "invalid_currency" });
});

test("rejects negative, fractional, non-finite, and unsafe amounts", () => {
  for (const invalid of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(calculateCheckoutQuote(input({ tipMinor: invalid })), { status: "invalid", reason: "invalid_amount" });
    assert.deepEqual(calculateCheckoutQuote(input({ appointment: { amountMinor: invalid, currency: "USD" } })), { status: "invalid", reason: "invalid_amount" });
    assert.deepEqual(calculateCheckoutQuote(input({ tax: { status: "resolved", amountMinor: invalid, currency: "USD" } })), { status: "invalid", reason: "invalid_amount" });
  }
});

test("rejects overflow and impossible discounts or ledger balances", () => {
  assert.deepEqual(calculateCheckoutQuote(input({ appointment: { amountMinor: Number.MAX_SAFE_INTEGER, currency: "USD" } })), { status: "invalid", reason: "amount_overflow" });
  assert.deepEqual(calculateCheckoutQuote(input({ tipMinor: Number.MAX_SAFE_INTEGER })), { status: "invalid", reason: "amount_overflow" });
  assert.deepEqual(calculateCheckoutQuote(input({ discountMinor: 5501 })), { status: "invalid", reason: "discount_exceeds_subtotal" });
  assert.deepEqual(calculateCheckoutQuote(input({ paidMinor: 100, refundedMinor: 101 })), { status: "invalid", reason: "refund_exceeds_payment" });
  assert.deepEqual(calculateCheckoutQuote(input({ paidMinor: 6201 })), { status: "invalid", reason: "payment_exceeds_total" });
});

test("does not mutate caller-owned add-on lines", () => {
  const addOns = Object.freeze([Object.freeze({ amountMinor: 1000, currency: "USD" })]);
  assert.equal(calculateCheckoutQuote(input({ addOns })).status, "ready");
  assert.equal(addOns[0].amountMinor, 1000);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/payments/sales-document-evidence.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { inspectSalesDocumentEvidence } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const candidate = Object.freeze({
  seller: Object.freeze({ name: "Fixture salon" }),
  client: Object.freeze({ name: "Fixture client" }),
  services: Object.freeze([Object.freeze({ description: "Fixture service", amountMinor: 4200, currency: "EUR" })]),
  adjustments: Object.freeze({ discountMinor: 0, tipMinor: 0, currency: "EUR" }),
  currency: "EUR",
  payment: Object.freeze({ status: "recorded", entries: Object.freeze([
    Object.freeze({ type: "payment", method: "cash", amountMinor: 2000, currency: "EUR" }),
    Object.freeze({ type: "payment", method: "external_card", amountMinor: 2200, currency: "EUR" }),
  ]) }),
  tax: Object.freeze({ status: "documented", amountMinor: 0, currency: "EUR", basis: "Fixture policy reference" }),
  totalMinor: 4200,
});

test("a structurally populated candidate remains blocked from issuance", () => {
  assert.deepEqual(inspectSalesDocumentEvidence(candidate), {
    kind: "draft_evidence_gaps", gaps: ["issuance_policy_unapproved"],
  });
  assert.equal("invoiceNumber" in inspectSalesDocumentEvidence(candidate), false);
});

test("missing seller, client, service, adjustments, currency, payment, tax and total fail closed", () => {
  assert.deepEqual(inspectSalesDocumentEvidence({}).gaps, [
    "issuance_policy_unapproved", "seller_snapshot_missing", "client_snapshot_missing",
    "currency_missing", "service_snapshot_missing", "adjustment_snapshot_missing", "payment_snapshot_missing",
    "tax_evidence_missing", "total_missing",
  ]);
  assert.deepEqual(inspectSalesDocumentEvidence(null).gaps, inspectSalesDocumentEvidence({}).gaps);
});

test("empty snapshots, unresolved tax and absent payment entries are not inferred from zero", () => {
  const result = inspectSalesDocumentEvidence({
    ...candidate, seller: { name: " " }, client: { name: "" },
    services: [{ description: "", amountMinor: 0, currency: "EUR" }],
    payment: { status: "recorded", entries: [] },
    tax: { status: "unresolved", amountMinor: 0, currency: "EUR" },
  });
  assert.deepEqual(result.gaps, [
    "issuance_policy_unapproved", "seller_snapshot_missing", "client_snapshot_missing",
    "service_snapshot_missing", "payment_snapshot_missing", "tax_evidence_missing",
  ]);
  assert.ok(inspectSalesDocumentEvidence({ ...candidate, tax: { ...candidate.tax, basis: "" } }).gaps.includes("tax_evidence_missing"));
});

test("an explicitly unpaid candidate needs no invented payment transaction", () => {
  assert.deepEqual(inspectSalesDocumentEvidence({ ...candidate, payment: { status: "unpaid" } }).gaps,
    ["issuance_policy_unapproved"]);
});

test("missing adjustments are not silently inferred as zero", () => {
  for (const adjustments of [undefined, {}, { discountMinor: 0 },
    { discountMinor: 0, tipMinor: -1, currency: "EUR" },
    { discountMinor: 0.5, tipMinor: 0, currency: "EUR" },
    { discountMinor: 0, tipMinor: 0, currency: "USD" }]) {
    assert.ok(inspectSalesDocumentEvidence({ ...candidate, adjustments }).gaps.includes("adjustment_snapshot_missing"));
  }
  assert.deepEqual(inspectSalesDocumentEvidence({ ...candidate,
    adjustments: { discountMinor: 200, tipMinor: 100, currency: "EUR" },
  }).gaps, ["issuance_policy_unapproved"]);
});

test("payment snapshots cannot refund more than collected or exceed safe integers", () => {
  for (const entries of [
    [{ type: "payment", method: "cash", amountMinor: 2000, currency: "EUR" },
      { type: "refund", method: "cash", amountMinor: 2001, currency: "EUR" }],
    [{ type: "payment", method: "cash", amountMinor: Number.MAX_SAFE_INTEGER, currency: "EUR" },
      { type: "payment", method: "external_card", amountMinor: 1, currency: "EUR" }],
  ]) assert.ok(inspectSalesDocumentEvidence({ ...candidate,
    payment: { status: "recorded", entries },
  }).gaps.includes("payment_ledger_inconsistent"));
  assert.deepEqual(inspectSalesDocumentEvidence({ ...candidate,
    payment: { status: "recorded", entries: [
      { type: "payment", method: "cash", amountMinor: 2000, currency: "EUR" },
    ] },
  }).gaps, ["issuance_policy_unapproved"]);
  assert.ok(inspectSalesDocumentEvidence({ ...candidate,
    payment: { status: "unpaid", entries: candidate.payment.entries },
  }).gaps.includes("payment_snapshot_missing"));
  assert.deepEqual(inspectSalesDocumentEvidence({ ...candidate,
    payment: { status: "unpaid", entries: null },
  }).gaps, ["issuance_policy_unapproved"]);
});

test("mixed currencies and invalid amounts cannot satisfy the evidence inventory", () => {
  const result = inspectSalesDocumentEvidence({
    ...candidate, currency: "EUR", totalMinor: Number.NaN,
    services: [{ description: "Fixture service", amountMinor: 100, currency: "USD" }],
    payment: { status: "recorded", entries: [{ type: "refund", method: "cash", amountMinor: -1, currency: "EUR" }] },
    tax: { ...candidate.tax, currency: "USD" },
  });
  assert.deepEqual(result.gaps, [
    "issuance_policy_unapproved", "service_snapshot_missing", "payment_snapshot_missing",
    "tax_evidence_missing", "total_missing",
  ]);
});

test("inspection never echoes personal or commercial input", () => {
  const secret = "private@example.invalid";
  const output = inspectSalesDocumentEvidence({
    ...candidate, seller: { name: secret }, client: { name: secret },
    services: [{ description: secret, amountMinor: 1, currency: "EUR" }],
    tax: { ...candidate.tax, basis: secret },
  });
  assert.equal(JSON.stringify(output).includes(secret), false);
});

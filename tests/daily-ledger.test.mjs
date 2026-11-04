import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/payments/daily-ledger.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { aggregateDailyLedger, MAX_DAILY_LEDGER_ENTRIES } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);

const scope = { tenantId: "salon-a", currency: "USD", timeZone: "America/New_York" };
const row = (occurred_at, amount, payment_method = "cash", entry_type = "payment") => ({
  tenant_id: scope.tenantId, currency: scope.currency, entry_type, payment_method, amount, occurred_at,
});

test("groups cash, external card, Stripe, and refunds by the salon's local day", () => {
  const entries = [
    row("2026-03-08T04:59:59Z", 1000),
    row("2026-03-08T05:00:00Z", 2000, "external_card"),
    row("2026-03-08T07:30:00Z", 500, "stripe"),
    row("2026-03-08T08:00:00Z", 300, "external_card", "refund"),
  ];
  assert.deepEqual(aggregateDailyLedger({ ...scope, entries }), {
    status: "ready", ...scope, days: [
      { date: "2026-03-07", paidMinor: 1000, refundedMinor: 0, netMinor: 1000,
        paymentsByMethod: { cash: 1000, external_card: 0, stripe: 0 },
        refundsByMethod: { cash: 0, external_card: 0, stripe: 0 } },
      { date: "2026-03-08", paidMinor: 2500, refundedMinor: 300, netMinor: 2200,
        paymentsByMethod: { cash: 0, external_card: 2000, stripe: 500 },
        refundsByMethod: { cash: 0, external_card: 300, stripe: 0 } },
    ],
  });
});

test("repeated fall-back hour stays on one local day; a refund can make a day negative", () => {
  const entries = [
    row("2026-11-01T03:59:59Z", 900, "cash", "refund"),
    row("2026-11-01T05:30:00Z", 100, "stripe"),
    row("2026-11-01T06:30:00Z", 200, "stripe"),
  ];
  const report = aggregateDailyLedger({ ...scope, entries });
  assert.equal(report.status, "ready");
  assert.deepEqual(report.days.map((day) => [day.date, day.netMinor]), [
    ["2026-10-31", -900], ["2026-11-01", 300],
  ]);
});

test("uses the requested salon zone, not UTC or the server zone", () => {
  const entries = [row("2026-01-01T23:30:00Z", 100)];
  const report = aggregateDailyLedger({ ...scope, timeZone: "Europe/Paris", entries });
  assert.equal(report.days[0].date, "2026-01-02");
});

test("date filters include only the selected salon-local day across both DST changes", () => {
  for (const [selectedDate, entries, expected] of [
    ["2026-03-08", [
      row("2026-03-08T04:59:59Z", 100),
      row("2026-03-08T05:00:00Z", 200),
      row("2026-03-09T03:59:59Z", 300),
      row("2026-03-09T04:00:00Z", 400),
    ], 500],
    ["2026-11-01", [
      row("2026-11-01T03:59:59Z", 100),
      row("2026-11-01T04:00:00Z", 200),
      row("2026-11-02T04:59:59Z", 300),
      row("2026-11-02T05:00:00Z", 400),
    ], 500],
  ]) {
    const report = aggregateDailyLedger({ ...scope, entries, fromDate: selectedDate, throughDate: selectedDate });
    assert.equal(report.status, "ready");
    assert.deepEqual(report.days.map((day) => [day.date, day.paidMinor]), [[selectedDate, expected]]);
  }
});

test("date filters reject invalid or inverted calendar dates and still validate excluded rows", () => {
  const entries = [row("2026-03-08T05:00:00Z", 100)];
  for (const dates of [
    { fromDate: "0000-01-01" },
    { throughDate: "0000-12-31" },
    { fromDate: "2026-02-30" },
    { throughDate: "2026-13-01" },
    { fromDate: "2026-03-09", throughDate: "2026-03-08" },
    { fromDate: "03/08/2026" },
  ]) {
    assert.deepEqual(aggregateDailyLedger({ ...scope, entries, ...dates }), { status: "invalid", reason: "invalid_scope" });
  }
  assert.deepEqual(aggregateDailyLedger({ ...scope, entries: [
    { ...entries[0], tenant_id: "salon-b" },
  ], fromDate: "2026-03-09" }), { status: "invalid", reason: "cross_tenant" });
});

test("rejects cross-tenant, mixed-currency, and malformed rows without partial totals", () => {
  const entries = [row("2026-03-08T05:00:00Z", 100)];
  for (const [bad, reason] of [
    [{ ...entries[0], tenant_id: "salon-b" }, "cross_tenant"],
    [{ ...entries[0], currency: "EUR" }, "currency_mismatch"],
    [{ ...entries[0], amount: -1 }, "invalid_entry"],
    [{ ...entries[0], amount: 1.5 }, "invalid_entry"],
    [{ ...entries[0], entry_type: "pending" }, "invalid_entry"],
    [{ ...entries[0], payment_method: "unknown" }, "invalid_entry"],
    [{ ...entries[0], occurred_at: "not-a-date" }, "invalid_entry"],
  ]) {
    assert.deepEqual(aggregateDailyLedger({ ...scope, entries: [entries[0], bad] }), { status: "invalid", reason });
  }
});

test("rejects invalid scope, unbounded sets, and integer overflow", () => {
  assert.deepEqual(aggregateDailyLedger({ ...scope, tenantId: " \t ", entries: [] }), { status: "invalid", reason: "invalid_scope" });
  assert.deepEqual(aggregateDailyLedger({ ...scope, tenantId: 42, entries: [] }), { status: "invalid", reason: "invalid_scope" });
  assert.deepEqual(aggregateDailyLedger({ ...scope, timeZone: "Unknown/Zone", entries: [] }), { status: "invalid", reason: "invalid_scope" });
  assert.deepEqual(aggregateDailyLedger({ ...scope, currency: "usd", entries: [] }), { status: "invalid", reason: "invalid_scope" });
  assert.deepEqual(aggregateDailyLedger({ ...scope, entries: Array(MAX_DAILY_LEDGER_ENTRIES + 1).fill(row("2026-01-01T00:00:00Z", 1)) }), { status: "invalid", reason: "too_many_entries" });
  assert.deepEqual(aggregateDailyLedger({ ...scope, entries: [row("2026-01-01T00:00:00Z", Number.MAX_SAFE_INTEGER), row("2026-01-01T01:00:00Z", 1)] }), { status: "invalid", reason: "amount_overflow" });
});

test("does not mutate caller rows", () => {
  const entry = Object.freeze(row("2026-01-01T00:00:00Z", 100));
  const entries = Object.freeze([entry]);
  assert.equal(aggregateDailyLedger({ ...scope, entries }).status, "ready");
  assert.equal(entry.amount, 100);
});

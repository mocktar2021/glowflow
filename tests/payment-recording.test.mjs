import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/payments/recording.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { localizedServiceTitle, parseMinorAmount, paymentSummary } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);

test("parses salon-entered amounts into integer minor units", () => {
  assert.equal(parseMinorAmount("12"), 1200);
  assert.equal(parseMinorAmount("12.3"), 1230);
  assert.equal(parseMinorAmount("12,34"), 1234);
  for (const invalid of ["", "0", "-1", "1.234", "1e3", "NaN", "900719925474099.99"]) {
    assert.equal(parseMinorAmount(invalid), null, invalid);
  }
});

test("derives appointment totals only from immutable ledger entries", () => {
  const entries = [
    { appointment_id: "a", entry_type: "payment", payment_method: "cash", amount: 2000 },
    { appointment_id: "a", entry_type: "payment", payment_method: "external_card", amount: 1500 },
    { appointment_id: "a", entry_type: "refund", payment_method: "cash", amount: 500 },
    { appointment_id: "b", entry_type: "payment", payment_method: "cash", amount: 9999 },
  ];
  assert.deepEqual(paymentSummary("a", 5000, entries), {
    paid: 3500, refunded: 500, netPaid: 3000, outstanding: 2000,
  });
});

test("uses the selected service title with a French fallback", () => {
  const title = { fr: "Coupe", en: "Cut" };
  assert.equal(localizedServiceTitle(title, "en"), "Cut");
  assert.equal(localizedServiceTitle(title, "es"), "Coupe");
});

test("migration enforces trusted snapshots, ownership, idempotency, and payment bounds", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260925194709_add_trusted_appointment_payment_recording.sql", import.meta.url), "utf8");
  assert.match(migration, /service_title_json = service\.title_json/);
  assert.match(migration, /new\.service_id := old\.service_id/);
  assert.match(migration, /new\.service_price := old\.service_price/);
  assert.match(migration, /membership\.role = 'owner'/);
  assert.match(migration, /payment_exceeds_outstanding_balance/);
  assert.match(migration, /exception when unique_violation/);
  assert.match(migration, /for update/);
  assert.doesNotMatch(migration, /application_fee_amount/);
});

test("payments page reads the complete displayed ledger and fails closed on query errors", async () => {
  const page = await readFile(new URL("../app/[locale]/dashboard/payments/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\.in\("appointment_id", appointmentIds\)/);
  assert.doesNotMatch(page, /payment_entries[\s\S]{0,200}\.limit\(/);
  assert.match(page, /ledgerUnavailable = !!appointmentsError \|\| !!entriesError/);
  assert.match(page, /ledgerUnavailable && <p role="alert"/);
  assert.match(page, /!ledgerUnavailable && <div/);
});

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
    { appointment_id: "a", currency: "USD", paid_amount: 3500, refunded_amount: 500, net_paid_amount: 3000 },
    { appointment_id: "b", currency: "USD", paid_amount: 9999, refunded_amount: 0, net_paid_amount: 9999 },
  ];
  assert.deepEqual(paymentSummary("a", 5000, entries), {
    paid: 3500, refunded: 500, netPaid: 3000, outstanding: 2000,
  });
});

test("uses the selected service title with a French fallback", () => {
  const title = { fr: "Coupe", en: "Cut" };
  assert.equal(localizedServiceTitle(title, "en"), "Cut");
  assert.equal(localizedServiceTitle(title, "es"), "Coupe");
  assert.equal(localizedServiceTitle({ en: "Cut" }, "es"), "Cut");
  for (const [locale, expected] of [["fr", "Prestation non renseignée"], ["en", "Service name unavailable"], ["es", "Servicio no especificado"]]) {
    assert.equal(localizedServiceTitle({}, locale), expected);
  }
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

test("payments page uses bounded grouped summaries and fails closed on query errors", async () => {
  const page = await readFile(new URL("../app/[locale]/dashboard/payments/page.tsx", import.meta.url), "utf8");
  assert.match(page, /rpc\("get_appointment_payment_summaries"/);
  assert.match(page, /target_appointment_ids: appointmentIds/);
  assert.doesNotMatch(page, /from\("payment_entries"\)/);
  assert.match(page, /ledgerUnavailable = !!appointmentsError \|\| !!summariesError/);
  assert.match(page, /ledgerUnavailable && <p role="alert"/);
  assert.match(page, /!ledgerUnavailable && <div/);
});

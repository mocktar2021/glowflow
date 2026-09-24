import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../lib/payment-diagnostics.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { reportPaymentFailure } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
test("diagnostics serialize only fixed stage and code for arbitrary hostile arguments", () => {
  const logs = []; const original = console.error;
  console.error = (...values) => logs.push(values);
  try {
    reportPaymentFailure("checkout_reserve", "reservation_rejected");
    const secret = "rk_test_sensitive customer@example.com https://private.invalid?secret=private";
    reportPaymentFailure(secret, { message: secret, toJSON() { throw new Error(secret); } });
    assert.deepEqual(logs.map(([line]) => JSON.parse(line)), [
      { event: "glowflow_payment_failure", environment: "sandbox", stage: "checkout_reserve", code: "reservation_rejected" },
      { event: "glowflow_payment_failure", environment: "sandbox", stage: "unknown", code: "operation_failed" },
    ]);
    console.error = () => { throw new Error("logger unavailable"); };
    assert.doesNotThrow(() => reportPaymentFailure("webhook_persist", "persistence_failed"));
  } finally { console.error = original; }
});

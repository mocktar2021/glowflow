import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadTypeScript(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const { classifyPaymentWebhookAlert } = await loadTypeScript("../lib/payment-webhook-operator-alert.ts");
const { reportPaymentFailure } = await loadTypeScript("../lib/payment-diagnostics.ts");

function diagnosticLine(stage, code) {
  let line;
  const original = console.error;
  console.error = (value) => { line = value; };
  try { reportPaymentFailure(stage, code); } finally { console.error = original; }
  return line;
}

test("existing webhook diagnostics become fixed, redacted operator alert candidates", () => {
  for (const [stage, code] of [
    ["webhook_client", "operation_failed"],
    ["webhook_event", "invalid_booking_fields"],
    ["webhook_persist", "persistence_failed"],
  ]) {
    const result = classifyPaymentWebhookAlert(diagnosticLine(stage, code));
    assert.equal(result.status, "actionable");
    assert.deepEqual(result.alert, {
      kind: "payment_webhook_failure",
      environment: "sandbox",
      stage,
      code,
      groupKey: `sandbox:${stage}:${code}`,
      action: "inspect_stripe_retry_and_reconcile_before_manual_action",
      primaryOperator: "Mocktar Tairou",
      primaryInbox: "glowflow@mocktar.com",
      backupInbox: "mocktar.technologies@gmail.com",
    });
  }
});

test("unrelated checkout failures are ignored and malformed webhook records fail closed", () => {
  assert.deepEqual(classifyPaymentWebhookAlert(diagnosticLine("checkout_reserve", "reservation_rejected")), { status: "ignored" });
  const hostile = { toString() { throw new Error("client@example.invalid"); } };
  for (const line of [
    null,
    hostile,
    "not json",
    "x".repeat(513),
    JSON.stringify({ event: "glowflow_payment_failure", environment: "sandbox", stage: "webhook_persist", code: "persistence_failed", email: "client@example.invalid" }),
    JSON.stringify({ event: "glowflow_payment_failure", environment: "sandbox", stage: "webhook_persist", code: "operation_failed" }),
    JSON.stringify({ event: "glowflow_payment_failure", environment: "sandbox", stage: "webhook_other", code: "persistence_failed" }),
    JSON.stringify({ event: "glowflow_payment_failure", environment: "live", stage: "webhook_persist", code: "persistence_failed" }),
  ]) {
    assert.deepEqual(classifyPaymentWebhookAlert(line), { status: "invalid" });
  }
});

test("the alert candidate stays disconnected from the live webhook route", async () => {
  const route = await readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8");
  assert.ok(!route.includes("payment-webhook-operator-alert"));
});

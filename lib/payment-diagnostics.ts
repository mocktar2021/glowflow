/** Server-only diagnostics: fixed vocabulary, never provider errors or customer data. */
const stages = ["checkout_owner", "checkout_platform", "checkout_reserve", "checkout_merchant", "checkout_parameters", "checkout_session", "checkout_attach", "checkout_status", "webhook_client", "webhook_persist"] as const;
export type PaymentStage = typeof stages[number];
const codes = ["operation_failed", "identity_mismatch", "reservation_rejected", "slot_unavailable", "persistence_failed"] as const;
export function reportPaymentFailure(stage: PaymentStage, code: typeof codes[number] = "operation_failed") {
  // Runtime allowlists also protect JavaScript callers; never serialize arbitrary arguments.
  const safeStage = stages.includes(stage) ? stage : "unknown";
  const safeCode = codes.includes(code) ? code : "operation_failed";
  try {
    console.error(JSON.stringify({ event: "glowflow_payment_failure", environment: "sandbox", stage: safeStage, code: safeCode }));
  } catch { /* Diagnostics must not change checkout/webhook retry semantics. */ }
}

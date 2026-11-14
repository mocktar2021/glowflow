/**
 * Inactive GLOW-34 log-to-alert boundary. No runtime code imports this module,
 * and it does not send, schedule, or acknowledge an alert.
 */
const webhookFailures = {
  webhook_client: "operation_failed",
  webhook_event: "invalid_booking_fields",
  webhook_persist: "persistence_failed",
} as const;
const checkoutStages = new Set([
  "checkout_owner", "checkout_platform", "checkout_reserve", "checkout_merchant",
  "checkout_parameters", "checkout_session", "checkout_attach", "checkout_status",
]);

type WebhookStage = keyof typeof webhookFailures;

export type PaymentWebhookOperatorAlert = Readonly<{
  kind: "payment_webhook_failure";
  environment: "sandbox";
  stage: WebhookStage;
  code: (typeof webhookFailures)[WebhookStage];
  groupKey: string;
  action: "inspect_stripe_retry_and_reconcile_before_manual_action";
  primaryOperator: "Mocktar Tairou";
  primaryInbox: "glowflow@mocktar.com";
  backupInbox: "mocktar.technologies@gmail.com";
}>;

export type PaymentAlertClassification =
  | { status: "actionable"; alert: PaymentWebhookOperatorAlert }
  | { status: "ignored" | "invalid" };

/**
 * A future approved log drain may call this on one diagnostic log line. Reject
 * extra fields rather than carrying customer, provider, or request details into
 * an operator alert. A null/invalid result must never be counted as healthy.
 */
export function classifyPaymentWebhookAlert(line: unknown): PaymentAlertClassification {
  if (typeof line !== "string" || line.length > 512) return { status: "invalid" };

  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { status: "invalid" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { status: "invalid" };
  const event = value as Record<string, unknown>;
  const keys = Object.keys(event);
  if (keys.length !== 4 || !["event", "environment", "stage", "code"].every((key) => keys.includes(key))) {
    return { status: "invalid" };
  }
  if (event.event !== "glowflow_payment_failure") return { status: "ignored" };
  if (event.environment !== "sandbox") return { status: "invalid" };
  if (typeof event.stage !== "string" || typeof event.code !== "string") return { status: "invalid" };
  if (!Object.hasOwn(webhookFailures, event.stage)) {
    // Checkout diagnostics are useful logs, but this contract alerts only on
    // webhook failures. Other unexpected stages fail closed.
    return checkoutStages.has(event.stage) ? { status: "ignored" } : { status: "invalid" };
  }
  const stage = event.stage as WebhookStage;
  if (event.code !== webhookFailures[stage]) return { status: "invalid" };

  return {
    status: "actionable",
    alert: {
      kind: "payment_webhook_failure",
      environment: "sandbox",
      stage,
      code: webhookFailures[stage],
      groupKey: `sandbox:${stage}:${webhookFailures[stage]}`,
      action: "inspect_stripe_retry_and_reconcile_before_manual_action",
      primaryOperator: "Mocktar Tairou",
      primaryInbox: "glowflow@mocktar.com",
      backupInbox: "mocktar.technologies@gmail.com",
    },
  };
}

import type Stripe from "stripe";

/**
 * Inert GLOW-53 ingress contract. A future, separately reviewed platform
 * webhook route must use a dedicated billing signing secret and persist event
 * IDs in an idempotent tenant-scoped ledger before acknowledging delivery.
 */
export type PlatformSubscriptionWebhookDecision =
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "invalid_signature" }>
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ kind: "retry"; reason: "identity_or_mode_mismatch" | "malformed_event" | "unhandled_financial_event" }>
  | Readonly<{
      kind: "subscription_event";
      eventId: string;
      eventType: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted";
      created: number;
      customerId: string;
      subscriptionId: string;
      status: string;
      livemode: boolean;
    }>;

const subscriptionTypes = new Set([
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
]);

// These cannot be silently acknowledged before their own reviewed handlers
// exist. This helper does not claim to reconcile invoices, refunds, or risk.
const unhandledFinancialTypes = new Set([
  "checkout.session.completed", "checkout.session.async_payment_succeeded",
  "invoice.paid", "invoice.payment_failed", "invoice.payment_action_required",
  "charge.dispute.created", "charge.refunded", "radar.early_fraud_warning.created",
]);

const subscriptionStatuses = new Set([
  "incomplete", "incomplete_expired", "trialing", "active", "past_due",
  "canceled", "unpaid", "paused",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Verify the original raw body before looking at any event fields. A malformed
 * signed event for a supported type is retried rather than acknowledged.
 * `stripe` must be the platform Stripe client, never a connected-account client.
 */
export function inspectPlatformSubscriptionWebhook(
  rawBody: unknown,
  signature: unknown,
  signingSecret: unknown,
  expectedLivemode: unknown,
  stripe: Pick<Stripe, "webhooks">,
): PlatformSubscriptionWebhookDecision {
  if (typeof signingSecret !== "string" || !/^whsec_\S+$/.test(signingSecret)
    || typeof expectedLivemode !== "boolean" || !stripe?.webhooks) return { kind: "unavailable" };
  if (typeof rawBody !== "string" || Buffer.byteLength(rawBody, "utf8") > 1024 * 1024
    || typeof signature !== "string" || signature.length === 0 || signature.length > 4096)
    return { kind: "invalid_signature" };

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, signingSecret);
  } catch {
    return { kind: "invalid_signature" };
  }

  if (!isRecord(event) || typeof event.type !== "string") return { kind: "retry", reason: "malformed_event" };
  const relevant = subscriptionTypes.has(event.type) || unhandledFinancialTypes.has(event.type);
  if (!relevant) return { kind: "ignored" };
  if (event.account != null || event.livemode !== expectedLivemode)
    return { kind: "retry", reason: "identity_or_mode_mismatch" };
  if (!/^evt_[A-Za-z0-9]+$/.test(event.id)
    || !Number.isSafeInteger(event.created) || event.created <= 0)
    return { kind: "retry", reason: "malformed_event" };
  if (unhandledFinancialTypes.has(event.type))
    return { kind: "retry", reason: "unhandled_financial_event" };

  const subscription: unknown = event.data?.object;
  if (!isRecord(subscription) || subscription.object !== "subscription"
    || !/^sub_[A-Za-z0-9]+$/.test(subscription.id as string)
    || !/^cus_[A-Za-z0-9]+$/.test(subscription.customer as string)
    || subscription.livemode !== expectedLivemode
    || typeof subscription.status !== "string"
    || !subscriptionStatuses.has(subscription.status))
    return { kind: "retry", reason: "malformed_event" };

  return Object.freeze({
    kind: "subscription_event" as const,
    eventId: event.id,
    eventType: event.type as "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted",
    created: event.created,
    customerId: subscription.customer as string,
    subscriptionId: subscription.id as string,
    status: subscription.status,
    livemode: expectedLivemode,
  });
}

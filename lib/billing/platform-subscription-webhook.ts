import type Stripe from "stripe";

/**
 * Inert GLOW-53 ingress contract. A future, separately reviewed platform
 * webhook route must use a dedicated billing signing secret and persist event
 * IDs in an idempotent tenant-scoped ledger before acknowledging delivery.
 */
export type PlatformSubscriptionWebhookDecision =
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "invalid_signature" }>
  | Readonly<{ kind: "retry"; reason: "identity_or_mode_mismatch" | "malformed_event" | "unhandled_event" }>
  | Readonly<{
      kind: "subscription_event";
      eventId: string;
      eventType: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted";
      created: number;
      customerId: string;
      subscriptionId: string;
      status: string;
      livemode: boolean;
    }>
  | Readonly<{
      kind: "invoice_event";
      eventId: string;
      eventType: "invoice.paid" | "invoice.payment_failed";
      created: number;
      invoiceId: string;
      customerId: string;
      subscriptionId: string;
      livemode: boolean;
    }>;

const subscriptionTypes = new Set([
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
]);
const invoiceTypes = new Set(["invoice.paid", "invoice.payment_failed"]);

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
  if (event.account != null || event.livemode !== expectedLivemode)
    return { kind: "retry", reason: "identity_or_mode_mismatch" };
  if (typeof event.id !== "string" || !/^evt_[A-Za-z0-9]+$/.test(event.id)
    || !Number.isSafeInteger(event.created) || event.created <= 0)
    return { kind: "retry", reason: "malformed_event" };
  // The dedicated billing endpoint must subscribe only to reviewed event
  // types. Any other signed delivery, including a new Stripe financial family
  // or an accidentally subscribed benign event, retries and alerts until a
  // handler or explicit acknowledgement policy is reviewed.
  if (!subscriptionTypes.has(event.type) && !invoiceTypes.has(event.type))
    return { kind: "retry", reason: "unhandled_event" };

  if (invoiceTypes.has(event.type)) {
    // Recent Stripe API versions place the first-class Subscription reference
    // under parent.subscription_details. A one-off invoice, an expanded object,
    // or a legacy invoice.subscription field is not enough to map a tenant.
    const invoice: unknown = event.data?.object;
    if (!isRecord(invoice) || invoice.object !== "invoice"
      || typeof invoice.id !== "string" || !/^in_[A-Za-z0-9]+$/.test(invoice.id)
      || typeof invoice.customer !== "string" || !/^cus_[A-Za-z0-9]+$/.test(invoice.customer)
      || invoice.livemode !== expectedLivemode
      || !isRecord(invoice.parent) || invoice.parent.type !== "subscription_details"
      || !isRecord(invoice.parent.subscription_details)
      || typeof invoice.parent.subscription_details.subscription !== "string"
      || !/^sub_[A-Za-z0-9]+$/.test(invoice.parent.subscription_details.subscription))
      return { kind: "retry", reason: "malformed_event" };

    return Object.freeze({
      kind: "invoice_event" as const,
      eventId: event.id,
      eventType: event.type as "invoice.paid" | "invoice.payment_failed",
      created: event.created,
      invoiceId: invoice.id,
      customerId: invoice.customer,
      subscriptionId: invoice.parent.subscription_details.subscription,
      livemode: expectedLivemode,
    });
  }

  const subscription: unknown = event.data?.object;
  if (!isRecord(subscription) || subscription.object !== "subscription"
    || typeof subscription.id !== "string" || !/^sub_[A-Za-z0-9]+$/.test(subscription.id)
    || typeof subscription.customer !== "string" || !/^cus_[A-Za-z0-9]+$/.test(subscription.customer)
    || subscription.livemode !== expectedLivemode
    || typeof subscription.status !== "string"
    || !subscriptionStatuses.has(subscription.status))
    return { kind: "retry", reason: "malformed_event" };

  return Object.freeze({
    kind: "subscription_event" as const,
    eventId: event.id,
    eventType: event.type as "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted",
    created: event.created,
    customerId: subscription.customer,
    subscriptionId: subscription.id,
    status: subscription.status,
    livemode: expectedLivemode,
  });
}

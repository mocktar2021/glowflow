import type Stripe from "stripe";

const eventTypes = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function malformed(): never {
  // The route maps this fixed error to a redacted diagnostic and a retryable 503.
  throw new Error("malformed_sandbox_deposit_event");
}

/** Only call with an event verified using the dedicated sandbox signing secret. */
export function sandboxDepositEventArguments(event: Stripe.Event) {
  const envelope = record(event as unknown) ? event as unknown as Record<string, unknown> : null;
  if (!envelope || typeof envelope.type !== "string" ||
      !eventTypes.has(envelope.type) || envelope.livemode !== false) return null;
  const data = record(envelope.data) ? envelope.data : null;
  const session = data && record(data.object) ? data.object : null;
  const metadata = session && record(session.metadata) ? session.metadata : null;
  // Without our product marker, a signed event cannot safely be attributed to GlowFlow.
  if (metadata?.product !== "glowflow") return null;
  if (typeof envelope.id !== "string" || !/^evt_\w+$/.test(envelope.id) ||
      typeof envelope.account !== "string" || !/^acct_\w+$/.test(envelope.account) ||
      session?.object !== "checkout.session" || session.mode !== "payment" ||
      session.livemode !== false || typeof session.id !== "string" ||
      !/^cs_test_\w+$/.test(session.id) || metadata.environment !== "sandbox" ||
      !["tenant_id", "appointment_id", "client_id", "reservation_id"].every(key =>
        typeof metadata[key] === "string" && uuid.test(metadata[key])) ||
      !Number.isSafeInteger(session.amount_total) || (session.amount_total as number) <= 0 ||
      typeof session.currency !== "string" || !/^[a-z]{3}$/.test(session.currency)) malformed();
  // Completion can precede settlement for delayed payment methods.
  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") &&
      session.payment_status !== "paid") return null;
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent
    : session.payment_intent == null ? null
    : record(session.payment_intent) ? session.payment_intent.id : undefined;
  if (paymentIntent !== null &&
      (typeof paymentIntent !== "string" || !/^pi_\w+$/.test(paymentIntent))) malformed();
  if (session.payment_status === "paid" && !paymentIntent) malformed();
  return {
    target_event_id: envelope.id,
    target_account_id: envelope.account,
    target_reservation_id: metadata.reservation_id,
    target_session_id: session.id,
    target_payment_intent_id: paymentIntent,
    target_event_type: event.type,
    target_amount: session.amount_total,
    target_currency: session.currency,
    target_tenant_id: metadata.tenant_id,
    target_appointment_id: metadata.appointment_id,
    target_client_id: metadata.client_id,
    target_livemode: false,
  };
}

import type Stripe from "stripe";

const eventTypes = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only call with an event verified using the dedicated sandbox signing secret. */
function parseSandboxDepositEvent(event: Stripe.Event, allowUnpaidCompletion = false) {
  if (!eventTypes.has(event.type) || event.livemode !== false ||
      !/^evt_\w+$/.test(event.id) || !/^acct_\w+$/.test(event.account ?? "")) return null;
  const session = event.data?.object as Stripe.Checkout.Session | undefined;
  const metadata = session?.metadata;
  if (session?.object !== "checkout.session" || session.mode !== "payment" ||
      session.livemode !== false || !/^cs_test_\w+$/.test(session.id) ||
      metadata?.environment !== "sandbox" || metadata?.product !== "glowflow" ||
      !["tenant_id", "appointment_id", "client_id", "reservation_id"].every(key => uuid.test(metadata[key] ?? "")) ||
      !Number.isSafeInteger(session.amount_total) || (session.amount_total ?? 0) <= 0 ||
      !/^[a-z]{3}$/.test(session.currency ?? "")) return null;
  // Completion can precede settlement for delayed payment methods.
  if (event.type === "checkout.session.async_payment_succeeded" && session.payment_status !== "paid") return null;
  if (event.type === "checkout.session.completed" && session.payment_status !== "paid" &&
      !(allowUnpaidCompletion && session.payment_status === "unpaid")) return null;
  const paymentIntent = typeof session.payment_intent === "string"
    ? session.payment_intent : session.payment_intent?.id ?? null;
  if (paymentIntent !== null && !/^pi_\w+$/.test(paymentIntent)) return null;
  if (session.payment_status === "paid" && !paymentIntent) return null;
  return {
    target_event_id: event.id,
    target_account_id: event.account!,
    target_reservation_id: metadata.reservation_id,
    target_session_id: session.id,
    target_payment_intent_id: paymentIntent,
    target_event_type: event.type,
    target_amount: session.amount_total!,
    target_currency: session.currency!,
    target_tenant_id: metadata.tenant_id,
    target_appointment_id: metadata.appointment_id,
    target_client_id: metadata.client_id,
    target_livemode: false,
  };
}

export function sandboxDepositEventArguments(event: Stripe.Event) {
  return parseSandboxDepositEvent(event);
}

/** A signed, clearly GlowFlow sandbox deposit event must not be silently lost. */
export function retryMalformedSandboxDepositEvent(event: Stripe.Event) {
  if (!eventTypes.has(event.type)) return false;
  const session = event.data?.object as Stripe.Checkout.Session | undefined;
  if (session?.metadata?.environment !== "sandbox" || session.metadata?.product !== "glowflow" ||
      session.mode === "subscription" || session.mode === "setup") return false;
  if (parseSandboxDepositEvent(event)) return false;
  // Delayed methods may complete before settlement. A fully valid unpaid
  // completion is expected; its later async success must carry the payment.
  if (event.type === "checkout.session.completed" && session.payment_status === "unpaid" &&
      parseSandboxDepositEvent(event, true)) return false;
  return true;
}

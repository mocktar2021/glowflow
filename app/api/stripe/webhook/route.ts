import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";
import { sandboxDepositConfiguration } from "@/lib/stripe-deposits-config";
import { sandboxDepositEventArguments } from "@/lib/stripe-deposit-events";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_SANDBOX_WEBHOOK_SECRET;
  if (!sandboxDepositConfiguration(process.env) || !/^whsec_\S+$/.test(secret ?? "")) {
    return Response.json({ error: "sandbox_unavailable" }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "invalid_signature" }, { status: 400 });
  let stripe;
  try {
    stripe = createStripeClient();
  } catch {
    return Response.json({ error: "sandbox_unavailable" }, { status: 503 });
  }
  let event;
  try {
    // Reading JSON and serializing it again would invalidate Stripe's signature.
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret!);
  } catch {
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }
  const args = sandboxDepositEventArguments(event);
  if (!args) return Response.json({ received: true });
  try {
    // PostgreSQL locks the reservation and atomically validates correlation,
    // deduplicates delivery and applies monotonic settlement/reconciliation.
    const { error } = await createAdminClient().rpc("process_stripe_sandbox_event", args);
    if (error) return Response.json({ error: "event_processing_failed" }, { status: 503 });
    return Response.json({ received: true });
  } catch {
    // Do not acknowledge failed persistence: Stripe must retry this delivery.
    return Response.json({ error: "event_processing_failed" }, { status: 503 });
  }
}

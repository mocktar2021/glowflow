import { NextResponse } from "next/server";

import { createStripeClient } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  try {
    const stripe = createStripeClient();
    const payload = await request.text();
    const event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
    );

    // Database state changes belong here. Checkout completion, expiration,
    // refunds, and disputes must stay idempotent by Stripe event ID.
    return NextResponse.json({ received: true, type: event.type });
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
}

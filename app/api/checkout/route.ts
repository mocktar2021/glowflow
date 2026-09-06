import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";

export const runtime = "nodejs";

const checkoutSchema = z.object({
  locale: z.enum(["fr", "en", "es"]),
  salonSlug: z.string().min(2).max(80),
  serviceId: z.string().uuid(),
  appointmentTime: z.string().datetime({ offset: true }),
});

type ServiceRecord = {
  id: string;
  title_json: Record<string, string>;
  deposit_amount: number;
  tenant: {
    slug: string;
    currency: string;
    stripe_account_id: string | null;
  };
};

export async function POST(request: Request) {
  const parsed = checkoutSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const stripe = createStripeClient();
    const { data, error } = await supabase
      .from("services")
      .select("id,title_json,deposit_amount,tenant:tenants!inner(slug,currency,stripe_account_id)")
      .eq("id", parsed.data.serviceId)
      .eq("tenants.slug", parsed.data.salonSlug)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "service_not_found" }, { status: 404 });
    }

    const service = data as unknown as ServiceRecord;
    if (!service.tenant.stripe_account_id || service.deposit_amount <= 0) {
      return NextResponse.json({ error: "payments_unavailable" }, { status: 409 });
    }

    const appOrigin = process.env.GLOWFLOW_APP_URL;
    if (!appOrigin) {
      return NextResponse.json({ error: "server_not_configured" }, { status: 503 });
    }

    // Launch pricing uses salon subscriptions, with no booking commission.
    const serviceName =
      service.title_json[parsed.data.locale] ?? service.title_json.fr ?? "GlowFlow service";
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        integration_identifier: "glowflow_booking_qxmdrpta",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: service.tenant.currency.toLowerCase(),
              unit_amount: service.deposit_amount,
              product_data: { name: `${serviceName} · deposit` },
            },
          },
        ],
        payment_intent_data: {
          metadata: {
            salon_slug: parsed.data.salonSlug,
            service_id: service.id,
            appointment_time: parsed.data.appointmentTime,
          },
        },
        metadata: {
          salon_slug: parsed.data.salonSlug,
          service_id: service.id,
          appointment_time: parsed.data.appointmentTime,
        },
        success_url: `${appOrigin}/${parsed.data.locale}/book/${parsed.data.salonSlug}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appOrigin}/${parsed.data.locale}/book/${parsed.data.salonSlug}?payment=canceled`,
      },
      { stripeAccount: service.tenant.stripe_account_id },
    );

    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: "checkout_unavailable" }, { status: 503 });
  }
}

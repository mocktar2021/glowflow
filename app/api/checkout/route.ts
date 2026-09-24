import { reportPaymentFailure, type PaymentStage } from "@/lib/payment-diagnostics";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createStripeClient } from "@/lib/stripe";
import { sandboxDepositConfiguration } from "@/lib/stripe-deposits-config";
import { assertSandboxMerchant, safeSandboxReservation, sandboxCheckoutParameters, type SandboxReservation } from "@/lib/stripe-deposits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const bookingSchema = z.object({
  salonSlug: z.string().trim().min(2).max(80),
  serviceId: z.string().uuid(), staffId: z.string().uuid(),
  startTime: z.string().datetime({ offset: true }),
  fullName: z.string().trim().min(2).max(120), phone: z.string().trim().max(40),
  email: z.union([z.literal(""), z.string().trim().email().max(160)]),
  locale: z.enum(["fr", "en", "es"]), requestKey: z.string().uuid(),
}).strict().refine((value) => value.phone.length > 0 || value.email.length > 0);
function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });
}
async function ownerTenant(salonSlug?: string) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  let query = client.from("tenants").select("id,slug").eq("owner_id", data.user.id);
  if (salonSlug) query = query.eq("slug", salonSlug);
  const { data: tenant, error: tenantError } = await query.single();
  return tenantError || !tenant ? null : { tenant, client };
}
export async function GET(request: Request) {
  if (!sandboxDepositConfiguration(process.env)) return reply({ error: "sandbox_unavailable" }, 503);
  const parsed = z.string().uuid().safeParse(new URL(request.url).searchParams.get("reservationId"));
  if (!parsed.success) return reply({ error: "invalid_request" }, 400);
  try {
    const owner = await ownerTenant();
    if (!owner) return reply({ error: "owner_required" }, 403);
    const { data, error } = await owner.client.from("stripe_sandbox_reservations")
      .select("id,status,expires_at,checkout_url").eq("id", parsed.data).eq("tenant_id", owner.tenant.id).single();
    if (error || !data) return reply({ error: "reservation_not_found" }, 404);
    return reply(safeSandboxReservation(data));
  } catch { reportPaymentFailure("checkout_status"); return reply({ error: "sandbox_unavailable" }, 503); }
}
export async function POST(request: Request) {
  const config = sandboxDepositConfiguration(process.env);
  if (!config) return reply({ error: "sandbox_unavailable" }, 503);
  let body: unknown;
  try { body = await request.json(); } catch { return reply({ error: "invalid_request" }, 400); }
  const parsed = bookingSchema.safeParse(body);
  if (!parsed.success) return reply({ error: "invalid_request" }, 400);
  let stage: PaymentStage = "checkout_owner";
  try {
    const owner = await ownerTenant(parsed.data.salonSlug);
    if (!owner) return reply({ error: "owner_required" }, 403);
    stage = "checkout_platform";
    const stripe = createStripeClient();
    const platform = await stripe.accounts.retrieve(null);
    if (platform.id !== config.platformAccountId) {
      reportPaymentFailure(stage, "identity_mismatch");
      return reply({ error: "sandbox_unavailable" }, 503);
    }
    stage = "checkout_reserve";
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("reserve_stripe_sandbox_booking", {
      target_salon_slug: parsed.data.salonSlug, target_service_id: parsed.data.serviceId,
      target_staff_id: parsed.data.staffId, requested_start: parsed.data.startTime,
      client_full_name: parsed.data.fullName, client_phone: parsed.data.phone,
      client_email: parsed.data.email, client_locale: parsed.data.locale, request_key: parsed.data.requestKey,
    });
    if (error || !data) {
      reportPaymentFailure(stage, error?.code === "23P01" ? "slot_unavailable" : "reservation_rejected");
      return reply({ error: error?.code === "23P01" ? "slot_unavailable" : "reservation_unavailable" }, 409);
    }
    const reservation = data as SandboxReservation;
    if (reservation.tenant_id !== owner.tenant.id) throw new Error("sandbox_unavailable");
    if (reservation.status !== "reserved") return reply(safeSandboxReservation(reservation));
    stage = "checkout_merchant";
    const account = await stripe.v2.core.accounts.retrieve(reservation.stripe_account_id, { include: ["configuration.merchant"] });
    assertSandboxMerchant(account, reservation);
    stage = "checkout_parameters";
    const parameters = sandboxCheckoutParameters(reservation, config.origin, owner.tenant.slug);
    stage = "checkout_session";
    const session = await stripe.checkout.sessions.create(parameters, {
      stripeAccount: reservation.stripe_account_id, idempotencyKey: `glowflow-sandbox-deposit-${reservation.id}`,
    });
    if (session.livemode || !session.url || session.metadata?.reservation_id !== reservation.id ||
        session.amount_total !== reservation.amount || session.currency !== reservation.currency.toLowerCase()) throw new Error("sandbox_unavailable");
    stage = "checkout_attach";
    const { data: attached, error: attachError } = await admin.rpc("attach_stripe_sandbox_checkout", {
      target_reservation_id: reservation.id, target_session_id: session.id, target_checkout_url: session.url,
    });
    if (attachError || !attached) throw new Error("reconciliation_required");
    return reply(safeSandboxReservation(attached as SandboxReservation));
  } catch (error) {
    reportPaymentFailure(stage);
    return reply({ error: error instanceof Error && error.message === "reconciliation_required" ? "reconciliation_required" : "checkout_unavailable" }, 503);
  }
}

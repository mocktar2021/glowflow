import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const localeSchema = z.enum(["fr", "en", "es"]);
const availabilitySchema = z.object({
  salonSlug: z.string().trim().min(2).max(80),
  serviceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const bookingSchema = z.object({
  salonSlug: z.string().trim().min(2).max(80),
  serviceId: z.string().uuid(),
  staffId: z.string().uuid(),
  startTime: z.string().datetime({ offset: true }),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40),
  email: z.union([z.literal(""), z.string().trim().email().max(160)]),
  locale: localeSchema,
  requestKey: z.string().uuid(),
}).refine((value) => value.phone.length > 0 || value.email.length > 0, {
  message: "contact_required",
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = availabilitySchema.safeParse({
    salonSlug: url.searchParams.get("salonSlug"),
    serviceId: url.searchParams.get("serviceId"),
    date: url.searchParams.get("date"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("get_public_booking_slots", {
    target_salon_slug: parsed.data.salonSlug,
    target_service_id: parsed.data.serviceId,
    target_local_date: parsed.data.date,
  });

  if (error) {
    return NextResponse.json({ error: "availability_failed" }, { status: 500 });
  }

  return NextResponse.json(
    { slots: data ?? [] },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const parsed = bookingSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("create_public_appointment", {
    target_salon_slug: parsed.data.salonSlug,
    target_service_id: parsed.data.serviceId,
    target_staff_id: parsed.data.staffId,
    requested_start: parsed.data.startTime,
    client_full_name: parsed.data.fullName,
    client_phone: parsed.data.phone,
    client_email: parsed.data.email,
    client_locale: parsed.data.locale,
    request_key: parsed.data.requestKey,
  });

  if (error) {
    const conflict = error.code === "23P01" || error.message.includes("public_time_unavailable");
    return NextResponse.json(
      { error: conflict ? "slot_unavailable" : "booking_failed" },
      { status: conflict ? 409 : 500 },
    );
  }

  const confirmation = Array.isArray(data) ? data[0] : data;
  if (!confirmation) {
    return NextResponse.json({ error: "booking_failed" }, { status: 500 });
  }

  return NextResponse.json({ confirmation }, { status: 201 });
}

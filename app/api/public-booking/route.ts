import { NextResponse } from "next/server";
import { z } from "zod";

import { reportApplicationFailure, type ApplicationCode, type ApplicationStage } from "@/lib/application-diagnostics";
import { publicBookingV2Enabled } from "@/lib/public-booking-v2-config";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function localizedText(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(([locale, text]) =>
    ["fr", "en", "es"].includes(locale) && typeof text === "string" && text.trim().length > 0);
  return entries.length ? Object.fromEntries(entries) : null;
}

function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value; } catch { return null; }
}

function validCurrency(value: unknown): string | null {
  // The current FR/US/ES catalogs use cents in EUR/USD. Other markets need an explicit unit contract.
  return value === "EUR" || value === "USD" ? value : null;
}
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

function failed(error: string, status: number, method: "GET" | "POST", stage: ApplicationStage, code: ApplicationCode) {
  const requestId = reportApplicationFailure("public_booking", method, stage, code);
  return NextResponse.json({ error }, {
    status,
    headers: { "cache-control": "private, no-store", ...(requestId ? { "x-glowflow-error-id": requestId } : {}) },
  });
}

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

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("get_public_booking_slots", {
      target_salon_slug: parsed.data.salonSlug,
      target_service_id: parsed.data.serviceId,
      target_local_date: parsed.data.date,
    });
    if (error) return failed("availability_failed", 500, "GET", "availability", "database_error");
    return NextResponse.json(
      { slots: data ?? [] },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return failed("availability_failed", 500, "GET", "availability", "unexpected_error");
  }
}

export async function POST(request: Request) {
  // Once v2 is enabled, arbitrary client-supplied keys must not bypass its
  // server-owned intent. The default-off rollout leaves legacy behavior intact.
  if (publicBookingV2Enabled()) {
    return NextResponse.json({ error: "booking_contract_changed" }, {
      status: 410, headers: { "cache-control": "private, no-store" },
    });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = bookingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let supabase;
  let data;
  let error;
  try {
    supabase = createAdminClient();
    ({ data, error } = await supabase.rpc("create_public_appointment", {
      target_salon_slug: parsed.data.salonSlug,
      target_service_id: parsed.data.serviceId,
      target_staff_id: parsed.data.staffId,
      requested_start: parsed.data.startTime,
      client_full_name: parsed.data.fullName,
      client_phone: parsed.data.phone,
      client_email: parsed.data.email,
      client_locale: parsed.data.locale,
      request_key: parsed.data.requestKey,
    }));
  } catch {
    return failed("booking_failed", 500, "POST", "create", "unexpected_error");
  }

  if (error) {
    const conflict = error.code === "23P01" ||
      (typeof error.message === "string" && error.message.includes("public_time_unavailable"));
    if (!conflict) return failed("booking_failed", 500, "POST", "create", "database_error");
    return NextResponse.json(
      { error: "slot_unavailable" },
      { status: 409 },
    );
  }

  const confirmation = Array.isArray(data) ? data[0] : data;
  if (!confirmation) {
    return failed("booking_failed", 500, "POST", "confirmation", "missing_confirmation");
  }

  // Enrichment must never turn an already committed booking into a failed request.
  // Read the stored appointment, rather than trusting the service in a retried body.
  let details = null;
  let publicSalonName = "";
  try {
    const { data: tenant, error: tenantError } = await supabase.from("tenants")
      .select("id,time_zone").eq("slug", parsed.data.salonSlug).single();
    if (tenant && !tenantError) {
      const { data: appointment, error: appointmentError } = await supabase.from("appointments")
        .select("service_id").eq("id", confirmation.appointment_id)
        .eq("tenant_id", tenant.id).eq("public_booking_request_key", parsed.data.requestKey).single();
      if (appointment && !appointmentError) {
        const [serviceResult, profileResult] = await Promise.all([
          supabase.from("services").select("title_json,price,currency")
            .eq("id", appointment.service_id).eq("tenant_id", tenant.id).single(),
          supabase.from("salon_public_profiles")
            .select("business_name,address_line1,city,administrative_area,postal_code,country_code,policies_json")
            .eq("tenant_id", tenant.id).eq("is_published", true).maybeSingle(),
        ]);
        const service = serviceResult.error ? null : serviceResult.data;
        const profile = profileResult.error ? null : profileResult.data;
        publicSalonName = profile?.business_name ?? "";
        details = {
          time_zone: validTimeZone(tenant.time_zone),
          address: typeof profile?.address_line1 === "string" && profile.address_line1.trim() ? [profile.address_line1, profile.city, profile.administrative_area, profile.postal_code, profile.country_code].filter((part) => typeof part === "string" && part.trim()).join(", ") || null : null,
          policies: localizedText(profile?.policies_json),
          catalog_price: service && Number.isSafeInteger(service.price) && service.price >= 0 ? service.price : null,
          currency: validCurrency(service?.currency),
          service_title: localizedText(service?.title_json),
        };
      }
    }
  } catch {
    // The booking reference remains usable even if optional public details cannot load.
    reportApplicationFailure("public_booking", "POST", "enrichment", "unexpected_error");
  }

  return NextResponse.json({ confirmation: { ...confirmation, salon_name: publicSalonName, details } }, {
    status: 201, headers: { "cache-control": "private, no-store" },
  });
}

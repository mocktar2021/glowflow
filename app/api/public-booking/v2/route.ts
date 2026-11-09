import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { publicBookingCapabilityQuotaKeys, publicBookingQuotaKeys } from "@/lib/public-booking-quota-keys";
import { publicBookingV2Mode } from "@/lib/public-booking-v2-config";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cookieName = "__Host-glowflow_booking_session";
const approvedCookieMaxAgeSeconds = 24 * 60 * 60;
const maxQuotaRetryAfterSeconds = 60 * 60;
const maxBodyBytes = 4096;
const tokenPattern = /^v1\.([1-9][0-9]{9,12})\.([1-9][0-9]{9,12})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;
const keyPattern = /^[A-Za-z0-9_-]{43}$/;
const uuid = z.string().uuid();
const slug = z.string().trim().min(2).max(80);
const locale = z.enum(["fr", "en", "es"]);
const bootstrapSchema = z.object({ action: z.literal("bootstrap") }).strict();
const prepareSchema = z.object({
  action: z.literal("prepare"), salonSlug: slug, serviceId: uuid, staffId: uuid,
  startTime: z.string().datetime({ offset: true }), fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40),
  email: z.union([z.literal(""), z.string().trim().email().max(160)]), locale,
  expectedGeneration: uuid,
}).strict().refine((value) => value.phone.length > 0 || value.email.length > 0);
const reconcileSchema = z.object({ action: z.literal("reconcile"), salonSlug: slug, intentId: uuid.optional() }).strict();
const intentSchema = z.object({
  action: z.enum(["commit", "cancel", "acknowledge"]), salonSlug: slug, intentId: uuid,
}).strict();

type Action = "prepare" | "reconcile" | "commit" | "cancel" | "acknowledge";
type Result = {
  state: "prepared" | "confirmed" | "not_committed" | "unknown" | "none";
  generation?: string;
  intent_id?: string;
  confirmation?: Record<string, unknown>;
};

function json(value: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(value, { status, headers: { "cache-control": "private, no-store", ...headers } });
}

function quotaOutcome(data: unknown, error: unknown): NextResponse | null {
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return json({ state: "unknown", error: "booking_unavailable" }, 503);
  }
  const result = data as Record<string, unknown>;
  if (result.allowed === true && result.retry_after === 0) return null;
  if (result.allowed === false && Number.isInteger(result.retry_after)
    && (result.retry_after as number) >= 1 && (result.retry_after as number) <= maxQuotaRetryAfterSeconds) {
    return json({ state: "unknown", error: "rate_limited" }, 429,
      { "retry-after": String(result.retry_after) });
  }
  return json({ state: "unknown", error: "booking_unavailable" }, 503);
}

async function quotaFailure(
  request: NextRequest, supabase: ReturnType<typeof createAdminClient>,
  action: "bootstrap" | "prepare" | "reconcile", token: string | null, salonSlug: string | null,
): Promise<NextResponse | null> {
  const keys = publicBookingQuotaKeys(request, token);
  if (!keys || (action === "bootstrap" ? keys.browserDigest !== null : !keys.browserDigest)) {
    return json({ state: "unknown", error: "booking_unavailable" }, 503);
  }
  const { data, error } = await supabase.rpc("consume_public_booking_quota", {
    quota_action: action, ip_digest: keys.ipDigest,
    browser_digest: keys.browserDigest, salon_slug: salonSlug,
  });
  return quotaOutcome(data, error);
}

async function capabilityQuotaFailure(
  supabase: ReturnType<typeof createAdminClient>, action: "commit" | "cancel" | "acknowledge",
  token: string, intentId: string, salonSlug: string,
): Promise<NextResponse | null> {
  const keys = publicBookingCapabilityQuotaKeys(token, intentId);
  if (!keys) return json({ state: "unknown", error: "booking_unavailable" }, 503);
  const { data, error } = await supabase.rpc("consume_public_booking_capability_quota", {
    quota_action: action, browser_digest: keys.browserDigest,
    intent_digest: keys.intentDigest, salon_slug: salonSlug,
  });
  return quotaOutcome(data, error);
}

function configuredCookieMaxAge(): number | null {
  // No default: privacy/ops must explicitly approve a bounded cookie lifetime
  // before a future gate-ON rollout can issue a new browser capability.
  const raw = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  const seconds = Number(raw);
  // The approved same-browser recovery window is at most 24 hours. A longer
  // browser capability must fail closed rather than outlive the privacy policy.
  return Number.isSafeInteger(seconds) && seconds >= 300 && seconds <= approvedCookieMaxAgeSeconds ? seconds : null;
}

function cookieSigningKey(): Buffer | null {
  const encoded = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY;
  // A single leaked key must not grant both cookie signing and quota reset.
  if (!encoded || !keyPattern.test(encoded)
    || encoded === process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY) return null;
  const key = Buffer.from(encoded, "base64url");
  return key.length === 32 && key.toString("base64url") === encoded
    && !key.equals(Buffer.alloc(32)) ? key : null;
}

function cookieSignature(request: NextRequest, payload: string, key: Buffer): Buffer {
  // Bind even a copied cookie to its issuing host. QA and production must not
  // share a browser capability if they ever share a database or signing key.
  return createHmac("sha256", key).update(new URL(request.url).host).update("\0").update(payload).digest();
}

function newBrowserToken(request: NextRequest, maxAge: number, key: Buffer): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `v1.${issuedAt}.${issuedAt + maxAge}.${randomBytes(32).toString("base64url")}`;
  return `${payload}.${cookieSignature(request, payload, key).toString("base64url")}`;
}

function validOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return origin === new URL(request.url).origin && (!fetchSite || fetchSite === "same-origin");
}

async function limitedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty_body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBodyBytes) {
      await reader.cancel();
      throw new Error("oversized_body");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function browserToken(request: NextRequest): string | null {
  // Reject duplicates rather than letting cookie parsing pick an attacker-chosen value.
  const count = (request.headers.get("cookie") ?? "").split(";")
    .filter((part) => part.trim().startsWith(`${cookieName}=`)).length;
  if (count !== 1) return null;
  const value = request.cookies.get(cookieName)?.value;
  const parts = value && tokenPattern.exec(value);
  if (!parts) return null;
  const issuedAt = Number(parts[1]);
  const expiresAt = Number(parts[2]);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)
    || expiresAt - issuedAt < 300 || expiresAt - issuedAt > approvedCookieMaxAgeSeconds
    || now < issuedAt || now >= expiresAt) return null;
  const key = cookieSigningKey();
  if (!key) return null;
  const payload = value.slice(0, value.lastIndexOf("."));
  const supplied = Buffer.from(parts[4], "base64url");
  const expected = cookieSignature(request, payload, key);
  // A noncanonical base64url tag can decode to the same HMAC while its raw
  // cookie bytes hash to a different browser session in PostgreSQL.
  return supplied.length === expected.length
    && supplied.toString("base64url") === parts[4]
    && timingSafeEqual(supplied, expected) ? value : null;
}

function localizedText(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([language, text]) =>
    ["fr", "en", "es"].includes(language) && typeof text === "string" && text.trim().length > 0));
}

function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value; } catch { return null; }
}

function validCurrency(value: unknown): string | null {
  return value === "EUR" || value === "USD" ? value : null;
}

function publicConfirmation(value: Record<string, unknown>): Record<string, unknown> | null {
  const start = typeof value.confirmed_start === "string" ? Date.parse(value.confirmed_start) : NaN;
  const end = typeof value.confirmed_end === "string" ? Date.parse(value.confirmed_end) : NaN;
  if (!uuid.safeParse(value.appointment_id).success || !Number.isFinite(start)
    || !Number.isFinite(end) || end <= start) return null;
  if (!["confirmed", "completed", "canceled", "no_show"].includes(String(value.appointment_status))) return null;
  if (!["fr", "en", "es"].includes(String(value.saved_locale))) return null;
  return {
    appointment_id: value.appointment_id,
    appointment_status: value.appointment_status,
    confirmed_start: value.confirmed_start,
    confirmed_end: value.confirmed_end,
    // The legacy RPC's salon_name is tenants.name, not the published profile.
    // The booking page already has the verified public name for display.
    salon_name: "",
    service_title: localizedText(value.service_title),
    currency: value.currency === "EUR" || value.currency === "USD" ? value.currency : "",
    saved_locale: value.saved_locale,
    // No unverified RPC enrichment is forwarded. Published address/policies
    // parity with v1 needs a separately reviewed server-side read model.
    details: null,
  };
}

function validResult(value: unknown, action: Action, expectedIntentId: string | null): Result | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!["prepared", "confirmed", "not_committed", "unknown", "none"].includes(String(raw.state))) return null;
  const state = raw.state as Result["state"];
  if (state === "unknown") return { state: "unknown" };
  const generation = typeof raw.generation === "string" && uuid.safeParse(raw.generation).success ? raw.generation : undefined;
  if (raw.generation !== undefined && !generation) return null;
  if (!generation) return null;
  const intentId = typeof raw.intent_id === "string" && uuid.safeParse(raw.intent_id).success ? raw.intent_id : undefined;
  if (["prepared", "confirmed", "not_committed"].includes(state) && !intentId) return null;
  if (expectedIntentId && intentId !== expectedIntentId
    && !(action === "acknowledge" && state === "none")) return null;
  if (state === "none" && expectedIntentId && action !== "acknowledge") return null;
  if (state === "confirmed") {
    const confirmation = raw.confirmation;
    if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)) return null;
    const safe = publicConfirmation(confirmation as Record<string, unknown>);
    if (!safe) return null;
    return { state, ...(generation ? { generation } : {}), ...(intentId ? { intent_id: intentId } : {}), confirmation: safe };
  }
  return { state, ...(generation ? { generation } : {}), ...(intentId ? { intent_id: intentId } : {}) };
}

async function enrichPublicConfirmation(
  supabase: ReturnType<typeof createAdminClient>, salonSlug: string, confirmation: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // The intent RPC already binds this appointment to the cookie, intent,
  // tenant, request key, and immutable start. Do not accept an appointment ID
  // or service ID from the browser for this privileged published-data read.
  try {
    const { data: tenant, error: tenantError } = await supabase.from("tenants")
      .select("id,time_zone").eq("slug", salonSlug).single();
    if (!tenant || tenantError) return confirmation;
    const { data: appointment, error: appointmentError } = await supabase.from("appointments")
      .select("service_id").eq("id", confirmation.appointment_id)
      .eq("tenant_id", tenant.id).eq("start_time", confirmation.confirmed_start).single();
    if (!appointment || appointmentError) return confirmation;
    const [serviceResult, profileResult] = await Promise.all([
      supabase.from("services").select("price,currency")
        .eq("id", appointment.service_id).eq("tenant_id", tenant.id).single(),
      supabase.from("salon_public_profiles")
        .select("business_name,address_line1,city,administrative_area,postal_code,country_code,policies_json")
        .eq("tenant_id", tenant.id).eq("is_published", true).maybeSingle(),
    ]);
    if (serviceResult.error || !serviceResult.data || profileResult.error) return confirmation;
    const service = serviceResult.data;
    const profile = profileResult.error ? null : profileResult.data;
    const address = typeof profile?.address_line1 === "string" && profile.address_line1.trim()
      ? [profile.address_line1, profile.city, profile.administrative_area, profile.postal_code, profile.country_code]
        .filter((part) => typeof part === "string" && part.trim()).join(", ") || null : null;
    return {
      ...confirmation,
      salon_name: typeof profile?.business_name === "string" ? profile.business_name : "",
      details: {
        time_zone: validTimeZone(tenant.time_zone),
        address,
        policies: localizedText(profile?.policies_json),
        catalog_price: service && Number.isSafeInteger(service.price) && service.price >= 0 ? service.price : null,
        currency: validCurrency(service?.currency),
        // The current catalog title may have changed since booking. The RPC
        // returns the appointment snapshot; never replace it with service.title_json.
        service_title: confirmation.service_title,
      },
    };
  } catch {
    // A confirmed appointment remains confirmed when optional public details
    // cannot be read. The allowlisted no-details response is still truthful.
    return confirmation;
  }
}

export async function POST(request: NextRequest) {
  const admission = publicBookingV2Mode();
  if (admission === "off") return json({ error: "not_found" }, 404);
  if (!validOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) {
    return json({ error: "invalid_content_type" }, 415);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) return json({ error: "invalid_request" }, 413);

  let body: unknown;
  try { body = await limitedJson(request); } catch { return json({ error: "invalid_request" }, 400); }
  if (bootstrapSchema.safeParse(body).success) {
    const existing = browserToken(request);
    if (!existing && request.cookies.has(cookieName)) return json({ state: "unknown" }, 409);
    // A signed cookie without a matching database session is not permission
    // to create a new one. No-cookie recovery is impossible in this mode.
    if (admission === "recovery_only") {
      if (!existing) return json({ state: "unknown" }, 409);
      return json({ ready: true, new_session: false, admission });
    }
    const maxAge = configuredCookieMaxAge();
    const signingKey = cookieSigningKey();
    if (!existing && (!maxAge || !signingKey)) return json({ state: "unknown", error: "booking_unavailable" }, 503);
    if (!existing) {
      // Reusing an authenticated browser capability issues no cookie. Do not
      // let its repeated bootstrap calls exhaust the shared IP issuance cap.
      try {
        const quota = await quotaFailure(request, createAdminClient(), "bootstrap", null, null);
        if (quota) return quota;
      } catch { return json({ state: "unknown", error: "booking_unavailable" }, 503); }
    }
    const response = json({ ready: true, new_session: !existing });
    if (!existing) {
      response.cookies.set(cookieName, newBrowserToken(request, maxAge!, signingKey!), {
        httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: maxAge!,
      });
    }
    return response;
  }

  const parsedPrepare = prepareSchema.safeParse(body);
  const parsedReconcile = reconcileSchema.safeParse(body);
  const parsedIntent = intentSchema.safeParse(body);
  if (!parsedPrepare.success && !parsedReconcile.success && !parsedIntent.success) return json({ error: "invalid_request" }, 400);
  if (admission === "recovery_only" && (parsedPrepare.success
    || (parsedReconcile.success && !parsedReconcile.data.intentId))) {
    // The current no-ID reconcile RPC can INSERT a browser session. It must
    // remain closed until a reviewed, mode-aware SQL gate removes that path.
    return json({ state: "unknown", error: "booking_paused" }, 503);
  }
  if (parsedPrepare.success && !configuredCookieMaxAge()) return json({ state: "unknown", error: "booking_unavailable" }, 503);
  const token = browserToken(request);
  if (!token) return json({ state: "unknown" }, 409);
  const hash = createHash("sha256").update(token).digest("hex");

  let action: Action;
  let args: Record<string, unknown>;
  if (parsedPrepare.success) {
    action = "prepare";
    const input = parsedPrepare.data;
    args = {
      salon_slug: input.salonSlug, browser_token_hash: hash,
      service_id: input.serviceId, staff_id: input.staffId, requested_start: input.startTime,
      client_full_name: input.fullName, client_phone: input.phone, client_email: input.email,
      client_locale: input.locale, expected_generation: input.expectedGeneration,
    };
  } else if (parsedReconcile.success) {
    action = "reconcile";
    args = { salon_slug: parsedReconcile.data.salonSlug, browser_token_hash: hash, intent_id: parsedReconcile.data.intentId ?? null };
  } else {
    const input = parsedIntent.data!;
    action = input.action;
    args = { salon_slug: input.salonSlug, browser_token_hash: hash, intent_id: input.intentId.toLowerCase() };
  }

  try {
    const supabase = createAdminClient();
    if (action === "prepare" || action === "reconcile") {
      const quota = await quotaFailure(request, supabase, action, token, String(args.salon_slug));
      if (quota) return quota;
    } else {
      const quota = await capabilityQuotaFailure(supabase, action, token,
        String(args.intent_id), String(args.salon_slug));
      if (quota) return quota;
    }
    const { data, error } = await supabase.rpc(`${action}_public_booking_intent`, args);
    // An unseeded policy or missing v2 migration must never fall back to the legacy create RPC.
    if (error) return json({ state: "unknown", error: "booking_unavailable" }, 503);
    const expectedIntentId = parsedIntent.success ? parsedIntent.data.intentId.toLowerCase()
      : parsedReconcile.success ? parsedReconcile.data.intentId ?? null : null;
    const result = validResult(data, action, expectedIntentId);
    if (!result) return json({ state: "unknown", error: "booking_unavailable" }, 503);
    if (result.state === "confirmed" && result.confirmation) {
      const salonSlug = String(args.salon_slug);
      result.confirmation = await enrichPublicConfirmation(supabase, salonSlug, result.confirmation);
    }
    return json(result);
  } catch {
    return json({ state: "unknown", error: "booking_unavailable" }, 503);
  }
}

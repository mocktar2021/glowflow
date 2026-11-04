import { createHash, randomBytes } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { publicBookingV2Enabled } from "@/lib/public-booking-v2-config";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cookieName = "__Host-glowflow_booking_session";
const maxBodyBytes = 4096;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
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

function json(value: Record<string, unknown>, status = 200) {
  return NextResponse.json(value, { status, headers: { "cache-control": "private, no-store" } });
}

function configuredCookieMaxAge(): number | null {
  // No default: privacy/ops must explicitly approve a bounded cookie lifetime
  // before a future gate-ON rollout can issue a new browser capability.
  const raw = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) && seconds >= 300 && seconds <= 30 * 24 * 60 * 60 ? seconds : null;
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
  return value && tokenPattern.test(value) ? value : null;
}

function localizedText(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([language, text]) =>
    ["fr", "en", "es"].includes(language) && typeof text === "string" && text.trim().length > 0));
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

export async function POST(request: NextRequest) {
  if (!publicBookingV2Enabled()) return json({ error: "not_found" }, 404);
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
    const maxAge = configuredCookieMaxAge();
    if (!existing && !maxAge) return json({ state: "unknown", error: "booking_unavailable" }, 503);
    const response = json({ ready: true, new_session: !existing });
    if (!existing) {
      response.cookies.set(cookieName, randomBytes(32).toString("base64url"), {
        httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: maxAge!,
      });
    }
    return response;
  }

  const parsedPrepare = prepareSchema.safeParse(body);
  const parsedReconcile = reconcileSchema.safeParse(body);
  const parsedIntent = intentSchema.safeParse(body);
  if (!parsedPrepare.success && !parsedReconcile.success && !parsedIntent.success) return json({ error: "invalid_request" }, 400);
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
    args = { salon_slug: input.salonSlug, browser_token_hash: hash, intent_id: input.intentId };
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc(`${action}_public_booking_intent`, args);
    // An unseeded policy or missing v2 migration must never fall back to the legacy create RPC.
    if (error) return json({ state: "unknown", error: "booking_unavailable" }, 503);
    const expectedIntentId = parsedIntent.success ? parsedIntent.data.intentId
      : parsedReconcile.success ? parsedReconcile.data.intentId ?? null : null;
    const result = validResult(data, action, expectedIntentId);
    if (!result) return json({ state: "unknown", error: "booking_unavailable" }, 503);
    return json(result);
  } catch {
    return json({ state: "unknown", error: "booking_unavailable" }, 503);
  }
}

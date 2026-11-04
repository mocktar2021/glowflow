import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { NextRequest } from "next/server.js";

const require = createRequire(import.meta.url);
const origin = "https://glowflow.mocktar.com";
const endpoint = `${origin}/api/public-booking/v2`;
const cookieName = "__Host-glowflow_booking_session";
const token = "A".repeat(43);
const intentId = "11111111-1111-4111-8111-111111111111";
const otherIntentId = "22222222-2222-4222-8222-222222222222";
const generation = "33333333-3333-4333-8333-333333333333";
const prepare = {
  action: "prepare", salonSlug: "browser-fixture", serviceId: intentId, staffId: otherIntentId,
  startTime: "2030-01-15T10:00:00Z", fullName: "Fictional Client", phone: "", email: "fixture@example.invalid",
  locale: "en", expectedGeneration: generation,
};

async function load(file, dependencies) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", js)((name) => dependencies[name] ?? require(name), loaded.exports);
  return loaded.exports;
}

async function harness(enabled = true, rpcResult = { data: { state: "prepared", generation, intent_id: intentId }, error: null }) {
  const calls = [];
  const deps = {
    "@/lib/public-booking-v2-config": { publicBookingV2Enabled: () => enabled },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name, args) => {
      calls.push({ name, args });
      return typeof rpcResult === "function" ? rpcResult(name, args) : rpcResult;
    } }) },
  };
  const { POST } = await load("../app/api/public-booking/v2/route.ts", deps);
  return { calls, POST, deps };
}

async function post(POST, body, { cookie = token, headers = {}, url = endpoint } = {}) {
  const request = new NextRequest(url, {
    method: "POST",
    headers: {
      origin, "content-type": "application/json", "sec-fetch-site": "same-origin",
      ...(cookie ? { cookie: `${cookieName}=${cookie}` } : {}), ...headers,
    },
    body: JSON.stringify(body),
  });
  const response = await POST(request);
  return { response, value: await response.json() };
}

test("v2 gate OFF returns disabled before cookie or database access, while legacy POST is unchanged", async () => {
  const { POST, calls } = await harness(false);
  const { response } = await post(POST, { action: "bootstrap" }, { cookie: null });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(calls, []);

  const legacy = await load("../app/api/public-booking/route.ts", {
    "@/lib/public-booking-v2-config": { publicBookingV2Enabled: () => false },
    "@/lib/supabase/admin": { createAdminClient: () => { throw Error("database must not be used"); } },
    "@/lib/application-diagnostics": { reportApplicationFailure: () => null },
  });
  const oldResponse = await legacy.POST(new Request(`${origin}/api/public-booking`, { method: "POST", body: "{}" }));
  assert.equal(oldResponse.status, 400);
});

test("v2 gate ON blocks the old arbitrary-key POST before parsing or database access", async () => {
  const legacy = await load("../app/api/public-booking/route.ts", {
    "@/lib/public-booking-v2-config": { publicBookingV2Enabled: () => true },
    "@/lib/supabase/admin": { createAdminClient: () => { throw Error("legacy database access"); } },
    "@/lib/application-diagnostics": { reportApplicationFailure: () => null },
  });
  const response = await legacy.POST(new Request(`${origin}/api/public-booking`, { method: "POST", body: "not json" }));
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("bootstrap requires explicit cookie lifetime and uses a host-only HttpOnly Secure cookie", async () => {
  const previous = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
  try {
    delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
    const { POST, calls } = await harness();
    assert.equal((await post(POST, { action: "bootstrap" }, { cookie: null })).response.status, 503);
    process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "3600";
    const { response, value } = await post(POST, { action: "bootstrap" }, { cookie: null });
    assert.deepEqual(value, { ready: true, new_session: true });
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^__Host-glowflow_booking_session=[A-Za-z0-9_-]{43};/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=strict/i);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /Max-Age=3600/);
    assert.doesNotMatch(setCookie, /Domain=/i);
    assert.deepEqual(calls, []);
    assert.deepEqual((await post(POST, { action: "bootstrap" })).value, { ready: true, new_session: false });
  } finally {
    if (previous === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = previous;
  }
});

test("exact origin, fetch metadata, JSON, cookie and strict action schemas reject before RPC", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "3600";
  const { POST, calls } = await harness();
  assert.equal((await post(POST, prepare, { headers: { origin: "https://other.mocktar.com" } })).response.status, 403);
  assert.equal((await post(POST, prepare, { headers: { "sec-fetch-site": "same-site" } })).response.status, 403);
  assert.equal((await post(POST, prepare, { headers: { "content-type": "text/plain" } })).response.status, 415);
  assert.equal((await post(POST, { action: "commit", salonSlug: "browser-fixture", intentId, email: "smuggled@example.invalid" })).response.status, 400);
  assert.equal((await post(POST, prepare, { cookie: null })).response.status, 409);
  assert.equal((await post(POST, prepare, { headers: { cookie: `${cookieName}=${token}; ${cookieName}=${token}` } })).response.status, 409);
  assert.deepEqual(calls, []);
});

test("prepare passes only normalized inputs and hashed cookie to its exact service-role RPC", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "3600";
  const { POST, calls } = await harness();
  const { response, value } = await post(POST, prepare);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(value, { state: "prepared", generation, intent_id: intentId });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "prepare_public_booking_intent");
  assert.deepEqual(calls[0].args, {
    salon_slug: "browser-fixture",
    browser_token_hash: createHash("sha256").update(token).digest("hex"),
    service_id: intentId, staff_id: otherIntentId, requested_start: prepare.startTime,
    client_full_name: prepare.fullName, client_phone: "", client_email: prepare.email,
    client_locale: "en", expected_generation: generation,
  });
  assert.doesNotMatch(JSON.stringify(value), /Fictional Client|fixture@example.invalid|AAAA/);
});

test("missing cookie configuration, mismatched IDs and malformed terminal results never unlock", async () => {
  const previous = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
  try {
    delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
    const unavailable = await harness();
    assert.equal((await post(unavailable.POST, prepare)).response.status, 503);
    assert.deepEqual(unavailable.calls, []);
    process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "3600";
    for (const data of [
      { state: "not_committed", generation },
      { state: "not_committed", generation, intent_id: otherIntentId },
      { state: "none", generation },
    ]) {
      const { POST } = await harness(true, { data, error: null });
      const { response, value } = await post(POST, { action: "cancel", salonSlug: "browser-fixture", intentId });
      assert.equal(response.status, 503);
      assert.equal(value.state, "unknown");
    }
  } finally {
    if (previous === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = previous;
  }
});

test("a database policy error is unavailable and never falls back to the legacy booking RPC", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "3600";
  const { POST, calls } = await harness(true, { data: null, error: { code: "P0001", message: "booking_intent_policy_unconfigured" } });
  const { response, value } = await post(POST, prepare);
  assert.equal(response.status, 503);
  assert.deepEqual(value, { state: "unknown", error: "booking_unavailable" });
  assert.deepEqual(calls.map(({ name }) => name), ["prepare_public_booking_intent"]);
  assert.doesNotMatch(JSON.stringify(value), /policy_unconfigured|Fictional Client|fixture@example.invalid/);
});

test("confirmed RPC data is reduced to an explicit non-contact browser allowlist", async () => {
  const data = { state: "confirmed", generation, intent_id: intentId, confirmation: {
    appointment_id: otherIntentId, appointment_status: "confirmed",
    confirmed_start: "2030-01-15T10:00:00+00:00", confirmed_end: "2030-01-15T10:30:00+00:00",
    salon_name: "Private owner label", service_title: { en: "Test haircut", private: "secret" },
    currency: "EUR", saved_locale: "en", client_email: "fixture@example.invalid",
    client_phone: "+10000000000", details: { notes: "secret" },
  } };
  const { POST, calls } = await harness(true, { data, error: null });
  const { response, value } = await post(POST, { action: "commit", salonSlug: "browser-fixture", intentId });
  assert.equal(response.status, 200);
  assert.equal(calls[0].name, "commit_public_booking_intent");
  assert.deepEqual(value, { state: "confirmed", generation, intent_id: intentId, confirmation: {
    appointment_id: otherIntentId, appointment_status: "confirmed",
    confirmed_start: "2030-01-15T10:00:00+00:00", confirmed_end: "2030-01-15T10:30:00+00:00",
    salon_name: "", service_title: { en: "Test haircut" }, currency: "EUR", saved_locale: "en", details: null,
  } });
  assert.doesNotMatch(JSON.stringify(value), /fixture@example.invalid|Private owner label|secret|10000000000/);
});

import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { NextRequest } from "next/server.js";

const require = createRequire(import.meta.url);
const origin = "https://glowflow.mocktar.com";
const endpoint = `${origin}/api/public-booking/v2`;
const cookieName = "__Host-glowflow_booking_session";
const signingKey = Buffer.alloc(32, 17);
process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY = signingKey.toString("base64url");
function signedToken({ issuedAt = Math.floor(Date.now() / 1000), expiresAt = issuedAt + 86400,
  host = "glowflow.mocktar.com" } = {}) {
  const payload = `v1.${issuedAt}.${expiresAt}.${"A".repeat(43)}`;
  const signature = createHmac("sha256", signingKey).update(host).update("\0")
    .update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
const token = signedToken();
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

async function harness(enabled = true, rpcResult = { data: { state: "prepared", generation, intent_id: intentId }, error: null }, readModel = null,
  quotaResult = { data: { allowed: true, retry_after: 0 }, error: null }, quotaKeys = { ipDigest: "a".repeat(64), browserDigest: "b".repeat(64) },
  quotaKeyAdapter = null, capabilityKeyAdapter = null) {
  const calls = [];
  const quotaCalls = [];
  const rpcOrder = [];
  const deps = {
    "@/lib/public-booking-v2-config": { publicBookingV2Mode: () => enabled === "recovery_only" ? "recovery_only" : enabled ? "full" : "off" },
    "@/lib/public-booking-quota-keys": {
      publicBookingQuotaKeys: quotaKeyAdapter ?? ((_request, browserToken) => quotaKeys && {
        ...quotaKeys, browserDigest: browserToken === null ? null : quotaKeys.browserDigest,
      }),
      publicBookingCapabilityQuotaKeys: capabilityKeyAdapter ?? (() => quotaKeys && {
        browserDigest: quotaKeys.browserDigest, intentDigest: "c".repeat(64),
      }),
    },
    "@/lib/supabase/admin": { createAdminClient: () => ({ ...(readModel ? { from: readModel.from } : {}), rpc: async (name, args) => {
      rpcOrder.push(name);
      if (name === "consume_public_booking_quota" || name === "consume_public_booking_capability_quota") {
        quotaCalls.push({ name, args });
        return typeof quotaResult === "function" ? quotaResult(name, args) : quotaResult;
      }
      calls.push({ name, args });
      return typeof rpcResult === "function" ? rpcResult(name, args) : rpcResult;
    } }) },
  };
  const { POST } = await load("../app/api/public-booking/v2/route.ts", deps);
  return { calls, quotaCalls, rpcOrder, POST, deps };
}

function publishedReadModel(overrides = {}) {
  const rows = {
    tenants: [{ id: "tenant-a", slug: "browser-fixture", time_zone: "Europe/Paris" }],
    appointments: [{ id: otherIntentId, tenant_id: "tenant-a", start_time: "2030-01-15T10:00:00+00:00", service_id: intentId }],
    services: [{ id: intentId, tenant_id: "tenant-a", price: 5200, currency: "EUR", title_json: { en: "Changed catalog title" }, private_note: "SECRET" }],
    salon_public_profiles: [{ tenant_id: "tenant-a", is_published: true, business_name: "Published Salon", address_line1: "12 Public Street", city: "Paris", administrative_area: "", postal_code: "75001", country_code: "FR", policies_json: { fr: "Conditions publiques", en: "Published policy", es: "Condiciones públicas", private_note: "SECRET" }, private_note: "SECRET" }],
    ...overrides,
  };
  const reads = [];
  return { reads, from(table) {
    const filters = [];
    let columns = [];
    return {
      select(list) { columns = list.split(","); return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      async single() { return finish(false); },
      async maybeSingle() { return finish(true); },
    };
    function finish(optional) {
      reads.push({ table, columns, filters });
      const found = (rows[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value));
      if (found.length !== 1) return { data: null, error: optional && found.length === 0 ? null : { message: "no unique row" } };
      return { data: Object.fromEntries(columns.map(key => [key, found[0][key]])), error: null };
    }
  } };
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

test("tri-state admission defaults off and never interprets malformed flags as full creation", async () => {
  const { publicBookingV2Mode, publicBookingV2Enabled } = await load("../lib/public-booking-v2-config.ts", {});
  for (const [env, mode] of [
    [{}, "off"],
    [{ GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED: "false" }, "off"],
    [{ GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED: "true" }, "full"],
    [{ GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED: "true", GLOWFLOW_PUBLIC_BOOKING_V2_RECOVERY_ONLY: "true" }, "recovery_only"],
    [{ GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED: "false", GLOWFLOW_PUBLIC_BOOKING_V2_RECOVERY_ONLY: "true" }, "recovery_only"],
    [{ GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED: "unexpected" }, "recovery_only"],
    [{ GLOWFLOW_PUBLIC_BOOKING_V2_RECOVERY_ONLY: "unexpected" }, "recovery_only"],
  ]) {
    assert.equal(publicBookingV2Mode(env), mode);
    assert.equal(publicBookingV2Enabled(env), mode !== "off");
  }
});

test("recovery-only blocks capability issuance and new intents but allows exact signed-cookie recovery", async () => {
  const replies = {
    reconcile_public_booking_intent: { state: "prepared", generation, intent_id: intentId },
    commit_public_booking_intent: { state: "not_committed", generation, intent_id: intentId },
    cancel_public_booking_intent: { state: "not_committed", generation, intent_id: intentId },
    acknowledge_public_booking_intent: { state: "none", generation },
  };
  const { POST, calls, quotaCalls } = await harness("recovery_only", name => ({ data: replies[name], error: null }));
  const fresh = await post(POST, { action: "bootstrap" }, { cookie: null });
  assert.equal(fresh.response.status, 409);
  assert.equal(fresh.response.headers.get("set-cookie"), null);
  const existing = await post(POST, { action: "bootstrap" });
  assert.equal(existing.response.status, 200);
  assert.deepEqual(existing.value, { ready: true, new_session: false, admission: "recovery_only" });
  assert.equal(existing.response.headers.get("set-cookie"), null);
  for (const body of [prepare, { action: "reconcile", salonSlug: "browser-fixture" }]) {
    const blocked = await post(POST, body);
    assert.equal(blocked.response.status, 503);
    assert.deepEqual(blocked.value, { state: "unknown", error: "booking_paused" });
    assert.equal(blocked.response.headers.get("set-cookie"), null);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(quotaCalls, []);
  for (const action of ["reconcile", "commit", "cancel", "acknowledge"]) {
    const recovered = await post(POST, { action, salonSlug: "browser-fixture", intentId });
    assert.equal(recovered.response.status, 200, `${action} keeps the original capability available`);
  }
  assert.deepEqual(calls.map(({ name }) => name), [
    "reconcile_public_booking_intent", "commit_public_booking_intent",
    "cancel_public_booking_intent", "acknowledge_public_booking_intent",
  ]);
  assert.deepEqual(quotaCalls.map(({ args }) => args.quota_action), ["reconcile", "commit", "cancel", "acknowledge"]);

  const config = await load("../lib/public-booking-v2-config.ts", {});
  const legacy = await load("../app/api/public-booking/route.ts", {
    "@/lib/public-booking-v2-config": { publicBookingV2Enabled: () => config.publicBookingV2Enabled({ GLOWFLOW_PUBLIC_BOOKING_V2_RECOVERY_ONLY: "true" }) },
    "@/lib/supabase/admin": { createAdminClient: () => { throw Error("legacy database access"); } },
    "@/lib/application-diagnostics": { reportApplicationFailure: () => null },
  });
  const oldResponse = await legacy.POST(new Request(`${origin}/api/public-booking`, { method: "POST", body: "not json" }));
  assert.equal(oldResponse.status, 410, "recovery-only must not reopen the legacy write route");
});

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

test("quota denial blocks bootstrap before cookie issuance and has bounded retry header", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "86400";
  const { POST, calls, quotaCalls } = await harness(true, undefined, null,
    { data: { allowed: false, retry_after: 37 }, error: null });
  const { response, value } = await post(POST, { action: "bootstrap" }, { cookie: null });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "37");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(value, { state: "unknown", error: "rate_limited" });
  assert.deepEqual(quotaCalls, [{ name: "consume_public_booking_quota", args: {
    quota_action: "bootstrap", ip_digest: "a".repeat(64), browser_digest: null, salon_slug: null,
  } }]);
  assert.deepEqual(calls, []);
});

test("quota rejects prepare and reconcile before intent RPC without leaking contact or cookie", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "86400";
  const { POST, calls, quotaCalls } = await harness(true, undefined, null,
    { data: { allowed: false, retry_after: 3600 }, error: null });
  for (const body of [prepare, { action: "reconcile", salonSlug: "browser-fixture", intentId }]) {
    const { response, value } = await post(POST, body);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "3600");
    assert.deepEqual(value, { state: "unknown", error: "rate_limited" });
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(quotaCalls.map(({ args }) => args.quota_action), ["prepare", "reconcile"]);
  for (const { args } of quotaCalls) {
    assert.deepEqual(args, { quota_action: args.quota_action, ip_digest: "a".repeat(64),
      browser_digest: "b".repeat(64), salon_slug: "browser-fixture" });
    assert.doesNotMatch(JSON.stringify(args), /signed-browser-cookie|Fictional Client|fixture@example\.invalid|v1\./);
  }
});

test("invalid recovery cookies stop before quota or intent RPC", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "86400";
  const now = Math.floor(Date.now() / 1000);
  const invalidCookies = [
    { cookie: null },
    { cookie: "tampered" },
    { cookie: signedToken({ issuedAt: now - 86401, expiresAt: now - 1 }) },
    { headers: { cookie: `${cookieName}=${token}; ${cookieName}=${token}` } },
  ];
  for (const body of [prepare, { action: "reconcile", salonSlug: "browser-fixture", intentId },
    { action: "commit", salonSlug: "browser-fixture", intentId },
    { action: "cancel", salonSlug: "browser-fixture", intentId },
    { action: "acknowledge", salonSlug: "browser-fixture", intentId }]) {
    for (const options of invalidCookies) {
      const { POST, calls, quotaCalls } = await harness();
      const { response } = await post(POST, body, options);
      assert.equal(response.status, 409);
      assert.deepEqual(quotaCalls, []);
      assert.deepEqual(calls, []);
    }
  }
});

test("invalid existing bootstrap cookie cannot burn quota or mint a new capability", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "86400";
  const now = Math.floor(Date.now() / 1000);
  for (const options of [
    { cookie: "tampered" },
    { cookie: signedToken({ issuedAt: now - 86401, expiresAt: now - 1 }) },
    { headers: { cookie: `${cookieName}=${token}; ${cookieName}=${token}` } },
  ]) {
    const { POST, calls, quotaCalls } = await harness();
    const { response } = await post(POST, { action: "bootstrap" }, options);
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(quotaCalls, []);
    assert.deepEqual(calls, []);
  }
});

test("repeated valid-cookie bootstrap never burns shared-IP issuance quota", async () => {
  const { POST, calls, quotaCalls } = await harness(true, undefined, null,
    { data: { allowed: false, retry_after: 1 }, error: null });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { response, value } = await post(POST, { action: "bootstrap" });
    assert.equal(response.status, 200);
    assert.deepEqual(value, { ready: true, new_session: false });
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.deepEqual(quotaCalls, []);
  assert.deepEqual(calls, []);
});

test("allowed quota precedes prepare and reconcile with digest-only arguments", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "86400";
  const { POST, rpcOrder, quotaCalls } = await harness();
  for (const body of [prepare, { action: "reconcile", salonSlug: "browser-fixture", intentId }]) {
    const { response } = await post(POST, body, { headers: { "x-forwarded-for": "203.0.113.42" } });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(rpcOrder, [
    "consume_public_booking_quota", "prepare_public_booking_intent",
    "consume_public_booking_quota", "reconcile_public_booking_intent",
  ]);
  assert.equal(quotaCalls.length, 2);
  for (const { args } of quotaCalls) {
    assert.deepEqual(args, { quota_action: args.quota_action, ip_digest: "a".repeat(64),
      browser_digest: "b".repeat(64), salon_slug: "browser-fixture" });
    assert.doesNotMatch(JSON.stringify(args), /203\.0\.113\.42|v1\.|Fictional Client|fixture@example\.invalid/);
  }
});

test("real quota key adapter passes only digests and rejects absent or ambiguous Vercel IP", async () => {
  const realAdapter = (await load("../lib/public-booking-quota-keys.ts", { "server-only": {} })).publicBookingQuotaKeys;
  const priorVercel = process.env.VERCEL_ENV;
  const priorKey = process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY;
  const priorCookieAge = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
  try {
    process.env.VERCEL_ENV = "preview";
    process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY = Buffer.alloc(32, 29).toString("base64url");
    process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "86400";
    const { POST, calls, quotaCalls } = await harness(true, undefined, null, undefined, undefined, realAdapter);
    const valid = await post(POST, prepare, { headers: {
      "x-forwarded-for": "203.0.113.42", "x-vercel-forwarded-for": "203.0.113.42",
    } });
    assert.equal(valid.response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(quotaCalls.length, 1);
    assert.match(quotaCalls[0].args.ip_digest, /^[0-9a-f]{64}$/);
    assert.match(quotaCalls[0].args.browser_digest, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(quotaCalls[0].args), /203\.0\.113\.42|v1\.|Fictional Client|fixture@example\.invalid/);

    for (const headers of [{}, { "x-forwarded-for": "203.0.113.42, 10.0.0.1" },
      { "x-forwarded-for": "203.0.113.42", "x-vercel-forwarded-for": "203.0.113.43" }]) {
      const unavailable = await post(POST, prepare, { headers });
      assert.equal(unavailable.response.status, 503);
      assert.equal(unavailable.response.headers.get("retry-after"), null);
      assert.equal(quotaCalls.length, 1);
      assert.equal(calls.length, 1);
    }
  } finally {
    if (priorVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = priorVercel;
    if (priorKey === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY = priorKey;
    if (priorCookieAge === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = priorCookieAge;
  }
});

test("real capability adapter signs browser and exact intent without requiring an IP header", async () => {
  const realAdapter = (await load("../lib/public-booking-quota-keys.ts", { "server-only": {} }))
    .publicBookingCapabilityQuotaKeys;
  const previousVercel = process.env.VERCEL_ENV;
  const previousKey = process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY;
  try {
    process.env.VERCEL_ENV = "preview";
    process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY = Buffer.alloc(32, 29).toString("base64url");
    const { POST, calls, quotaCalls } = await harness(true,
      { data: { state: "not_committed", generation, intent_id: intentId }, error: null }, null, undefined,
      undefined, undefined, realAdapter);
    const { response } = await post(POST, { action: "commit", salonSlug: "browser-fixture", intentId });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(quotaCalls.length, 1);
    const args = quotaCalls[0].args;
    assert.match(args.browser_digest, /^[0-9a-f]{64}$/);
    assert.match(args.intent_digest, /^[0-9a-f]{64}$/);
    assert.notEqual(args.browser_digest, args.intent_digest);
    assert.doesNotMatch(JSON.stringify(args), /v1\.|11111111-1111|Fictional Client|fixture@example\.invalid/);
    delete process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY;
    const unavailable = await post(POST, { action: "cancel", salonSlug: "browser-fixture", intentId });
    assert.equal(unavailable.response.status, 503);
    assert.deepEqual(unavailable.value, { state: "unknown", error: "booking_unavailable" });
    assert.equal(quotaCalls.length, 1);
    assert.equal(calls.length, 1);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercel;
    if (previousKey === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY = previousKey;
  }
});

test("missing quota keys, RPC errors, and malformed responses fail closed", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "86400";
  for (const quotaResult of [
    { data: null, error: { message: "policy missing" } },
    { data: null, error: null },
    { data: { allowed: true, retry_after: 1 }, error: null },
    { data: { allowed: false, retry_after: 0 }, error: null },
    { data: { allowed: false, retry_after: 3601 }, error: null },
    { data: { allowed: "false", retry_after: 30 }, error: null },
  ]) {
    const { POST, calls } = await harness(true, undefined, null, quotaResult);
    const { response } = await post(POST, prepare);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), null);
    assert.deepEqual(calls, []);
  }
  const { POST, calls, quotaCalls } = await harness(true, undefined, null, undefined, null);
  assert.equal((await post(POST, prepare)).response.status, 503);
  assert.deepEqual(calls, []);
  assert.deepEqual(quotaCalls, []);
  const throwing = await harness(true, undefined, null, () => { throw Error("quota transport failed"); });
  assert.equal((await post(throwing.POST, prepare)).response.status, 503);
  assert.deepEqual(throwing.calls, []);
  assert.equal(throwing.quotaCalls.length, 1);
});

test("commit, cancel and acknowledge consume their own capability quota before action RPC", async () => {
  const { POST, calls, quotaCalls, rpcOrder } = await harness(true, name => ({
    data: name === "acknowledge_public_booking_intent"
      ? { state: "none", generation }
      : { state: "not_committed", generation, intent_id: intentId },
    error: null,
  }));
  for (const action of ["commit", "cancel", "acknowledge"]) {
    const { response } = await post(POST, { action, salonSlug: "browser-fixture", intentId });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(rpcOrder, [
    "consume_public_booking_capability_quota", "commit_public_booking_intent",
    "consume_public_booking_capability_quota", "cancel_public_booking_intent",
    "consume_public_booking_capability_quota", "acknowledge_public_booking_intent",
  ]);
  assert.deepEqual(calls.map(({ name }) => name), [
    "commit_public_booking_intent", "cancel_public_booking_intent", "acknowledge_public_booking_intent",
  ]);
  assert.deepEqual(quotaCalls.map(({ args }) => args.quota_action), ["commit", "cancel", "acknowledge"]);
  for (const { args } of quotaCalls) {
    assert.deepEqual(args, { quota_action: args.quota_action, browser_digest: "b".repeat(64),
      intent_digest: "c".repeat(64), salon_slug: "browser-fixture" });
    assert.doesNotMatch(JSON.stringify(args), /v1\.|11111111-1111|203\.0\.113\.42/);
  }
});

test("capability denial returns no-store 429 without burning an action RPC or changing cookie", async () => {
  const { POST, calls, quotaCalls } = await harness(true, undefined, null,
    { data: { allowed: false, retry_after: 43 }, error: null });
  for (const action of ["commit", "cancel", "acknowledge"]) {
    const { response, value } = await post(POST, { action, salonSlug: "browser-fixture", intentId });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "43");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(value, { state: "unknown", error: "rate_limited" });
  }
  assert.deepEqual(quotaCalls.map(({ name }) => name), Array(3).fill("consume_public_booking_capability_quota"));
  assert.deepEqual(calls, [], "denial must not invoke an action RPC");
});

test("missing or malformed capability policy fails closed before action RPC", async () => {
  for (const quotaResult of [
    { data: null, error: { message: "booking_capability_quota_policy_unconfigured" } },
    { data: null, error: null },
    { data: { allowed: true, retry_after: 1 }, error: null },
    { data: { allowed: false, retry_after: 0 }, error: null },
    { data: { allowed: false, retry_after: 3601 }, error: null },
  ]) {
    const { POST, calls } = await harness(true, undefined, null, quotaResult);
    const { response, value } = await post(POST, { action: "commit", salonSlug: "browser-fixture", intentId });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("retry-after"), null);
    assert.deepEqual(value, { state: "unknown", error: "booking_unavailable" });
    assert.deepEqual(calls, []);
  }
  const unavailable = await harness(true, undefined, null, undefined, undefined,
    undefined, () => null);
  assert.equal((await post(unavailable.POST, { action: "cancel", salonSlug: "browser-fixture", intentId })).response.status, 503);
  assert.deepEqual(unavailable.quotaCalls, []);
  assert.deepEqual(unavailable.calls, []);
});

test("a denied replay reconciles the original committed appointment without another commit", async () => {
  const confirmed = { state: "confirmed", generation, intent_id: intentId, confirmation: {
    appointment_id: otherIntentId, appointment_status: "confirmed",
    confirmed_start: "2030-01-15T10:00:00+00:00", confirmed_end: "2030-01-15T10:30:00+00:00",
    service_title: { en: "Booked title" }, currency: "EUR", saved_locale: "en",
  } };
  let commitQuotaCalls = 0;
  const { POST, calls, quotaCalls, rpcOrder } = await harness(true,
    { data: confirmed, error: null }, null, (_name, args) => {
      if (args.quota_action === "commit" && ++commitQuotaCalls === 2) {
        return { data: { allowed: false, retry_after: 35 }, error: null };
      }
      return { data: { allowed: true, retry_after: 0 }, error: null };
    });
  const first = await post(POST, { action: "commit", salonSlug: "browser-fixture", intentId });
  assert.equal(first.response.status, 200);
  // Model the caller losing the first 200 and retrying the exact intent.
  const replay = await post(POST, { action: "commit", salonSlug: "browser-fixture", intentId });
  assert.equal(replay.response.status, 429);
  assert.equal(replay.response.headers.get("retry-after"), "35");
  const recovered = await post(POST, { action: "reconcile", salonSlug: "browser-fixture", intentId });
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.value.state, "confirmed");
  assert.equal(recovered.value.intent_id, intentId);
  assert.equal(recovered.value.confirmation.appointment_id, first.value.confirmation.appointment_id);
  assert.deepEqual(calls.map(({ name }) => name), [
    "commit_public_booking_intent", "reconcile_public_booking_intent",
  ]);
  assert.deepEqual(quotaCalls.map(({ args }) => args.quota_action), ["commit", "commit", "reconcile"]);
  assert.deepEqual(rpcOrder, [
    "consume_public_booking_capability_quota", "commit_public_booking_intent",
    "consume_public_booking_capability_quota", "consume_public_booking_quota", "reconcile_public_booking_intent",
  ]);
});

test("bootstrap requires explicit cookie lifetime and uses a host-only HttpOnly Secure cookie", async () => {
  const previous = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
  try {
    delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
    const { POST, calls, quotaCalls } = await harness();
    assert.equal((await post(POST, { action: "bootstrap" }, { cookie: null })).response.status, 503);
    process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "86400";
    const { response, value } = await post(POST, { action: "bootstrap" }, { cookie: null });
    assert.deepEqual(value, { ready: true, new_session: true });
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^__Host-glowflow_booking_session=v1\.[0-9]+\.[0-9]+\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43};/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=strict/i);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /Max-Age=86400/);
    assert.doesNotMatch(setCookie, /Domain=/i);
    assert.deepEqual(calls, []);
    assert.deepEqual(quotaCalls.map(({ args }) => args.quota_action), ["bootstrap"]);
    assert.deepEqual((await post(POST, { action: "bootstrap" })).value, { ready: true, new_session: false });
    assert.equal(quotaCalls.length, 1);
  } finally {
    if (previous === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = previous;
  }
});

test("signed cookie proves issue time and host after database session purge", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "86400";
  const { POST, calls } = await harness();
  const now = Math.floor(Date.now() / 1000);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const lastIndex = alphabet.indexOf(token.at(-1));
  const noncanonicalTag = `${token.slice(0, -1)}${alphabet[(lastIndex & ~3) | ((lastIndex + 1) & 3)]}`;
  assert.notEqual(noncanonicalTag, token);
  assert.deepEqual(Buffer.from(noncanonicalTag.split(".").at(-1), "base64url"),
    Buffer.from(token.split(".").at(-1), "base64url"));
  for (const stale of [
    signedToken({ issuedAt: now - 86401, expiresAt: now - 1 }),
    signedToken({ issuedAt: now + 60, expiresAt: now + 86460 }),
    signedToken({ issuedAt: now, expiresAt: now + 86401 }),
    `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
    noncanonicalTag,
    "A".repeat(43), // pre-signature draft format must not silently rebootstrap
  ]) {
    const bootstrap = await post(POST, { action: "bootstrap" }, { cookie: stale });
    assert.equal(bootstrap.response.status, 409);
    assert.equal(bootstrap.response.headers.get("set-cookie"), null);
    assert.equal((await post(POST, { action: "reconcile", salonSlug: "browser-fixture" }, { cookie: stale })).response.status, 409);
  }
  const crossHost = await post(POST, { action: "bootstrap" }, {
    cookie: token, url: "https://glowflow.beauty/api/public-booking/v2",
    headers: { origin: "https://glowflow.beauty" },
  });
  assert.equal(crossHost.response.status, 409);
  assert.equal(crossHost.response.headers.get("set-cookie"), null);
  assert.deepEqual(calls, []);
});

test("missing signing key blocks new capabilities and cannot validate old cookies", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "86400";
  const previous = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY;
  try {
    delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY;
    const { POST, calls } = await harness();
    assert.equal((await post(POST, { action: "bootstrap" }, { cookie: null })).response.status, 503);
    assert.equal((await post(POST, { action: "reconcile", salonSlug: "browser-fixture" })).response.status, 409);
    assert.deepEqual(calls, []);
  } finally {
    if (previous === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY = previous;
  }
});

test("an all-zero signing key cannot issue or validate browser capabilities", async () => {
  const previous = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY;
  const previousMaxAge = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
  try {
    process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "3600";
    const zeroKey = Buffer.alloc(32);
    process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY = zeroKey.toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const payload = `v1.${now}.${now + 3600}.${"B".repeat(43)}`;
    const forged = `${payload}.${createHmac("sha256", zeroKey)
      .update("glowflow.mocktar.com").update("\0").update(payload).digest("base64url")}`;
    const { POST, calls, quotaCalls } = await harness();
    const fresh = await post(POST, { action: "bootstrap" }, { cookie: null });
    assert.equal(fresh.response.status, 503);
    assert.equal(fresh.response.headers.get("set-cookie"), null);
    for (const cookie of [token, forged]) {
      const existing = await post(POST, { action: "bootstrap" }, { cookie });
      assert.equal(existing.response.status, 409);
      assert.equal(existing.response.headers.get("set-cookie"), null);
      assert.equal((await post(POST, { action: "reconcile", salonSlug: "browser-fixture", intentId }, { cookie })).response.status, 409);
    }
    assert.deepEqual(quotaCalls, []);
    assert.deepEqual(calls, []);
  } finally {
    if (previous === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY = previous;
    if (previousMaxAge === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = previousMaxAge;
  }
});

test("reusing the quota HMAC key as the cookie signer fails closed", async () => {
  const previousQuotaKey = process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY;
  const previousMaxAge = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
  try {
    process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY = signingKey.toString("base64url");
    process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "3600";
    const { POST, calls, quotaCalls } = await harness();
    const fresh = await post(POST, { action: "bootstrap" }, { cookie: null });
    assert.equal(fresh.response.status, 503);
    assert.equal(fresh.response.headers.get("set-cookie"), null);
    assert.equal((await post(POST, { action: "bootstrap" })).response.status, 409);
    assert.equal((await post(POST, { action: "reconcile", salonSlug: "browser-fixture", intentId })).response.status, 409);
    assert.deepEqual(quotaCalls, []);
    assert.deepEqual(calls, []);
  } finally {
    if (previousQuotaKey === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY = previousQuotaKey;
    if (previousMaxAge === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = previousMaxAge;
  }
});

test("removing cookie lifetime pauses new bookings while exact signed-cookie recovery remains available", async () => {
  const previous = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
  try {
    delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
    const confirmed = { state: "confirmed", generation, intent_id: intentId, confirmation: {
      appointment_id: otherIntentId, appointment_status: "confirmed",
      confirmed_start: "2030-01-15T10:00:00+00:00", confirmed_end: "2030-01-15T10:30:00+00:00",
      service_title: { en: "Booked title" }, currency: "EUR", saved_locale: "en",
    } };
    const replies = {
      reconcile_public_booking_intent: { state: "prepared", generation, intent_id: intentId },
      commit_public_booking_intent: confirmed,
      cancel_public_booking_intent: { state: "not_committed", generation, intent_id: intentId },
      acknowledge_public_booking_intent: { state: "none", generation },
    };
    const { POST, calls, quotaCalls } = await harness(true,
      name => ({ data: replies[name], error: null }));
    const fresh = await post(POST, { action: "bootstrap" }, { cookie: null });
    assert.equal(fresh.response.status, 503);
    assert.equal(fresh.response.headers.get("set-cookie"), null);
    const prepared = await post(POST, prepare);
    assert.equal(prepared.response.status, 503);
    assert.equal(prepared.response.headers.get("set-cookie"), null);
    const existing = await post(POST, { action: "bootstrap" });
    assert.equal(existing.response.status, 200);
    assert.deepEqual(existing.value, { ready: true, new_session: false });
    assert.equal(existing.response.headers.get("set-cookie"), null);
    for (const action of ["reconcile", "commit", "cancel", "acknowledge"]) {
      const result = await post(POST, { action, salonSlug: "browser-fixture", intentId });
      assert.equal(result.response.status, 200, `${action} must remain available to the existing signed cookie`);
      assert.equal(result.response.headers.get("set-cookie"), null);
    }
    assert.deepEqual(calls.map(({ name }) => name), [
      "reconcile_public_booking_intent", "commit_public_booking_intent",
      "cancel_public_booking_intent", "acknowledge_public_booking_intent",
    ]);
    assert.deepEqual(quotaCalls.map(({ args }) => args.quota_action), [
      "reconcile", "commit", "cancel", "acknowledge",
    ]);

    const legacy = await load("../app/api/public-booking/route.ts", {
      "@/lib/public-booking-v2-config": { publicBookingV2Enabled: () => true },
      "@/lib/supabase/admin": { createAdminClient: () => { throw Error("legacy database access"); } },
      "@/lib/application-diagnostics": { reportApplicationFailure: () => null },
    });
    const legacyResponse = await legacy.POST(new Request(`${origin}/api/public-booking`, { method: "POST", body: "not json" }));
    assert.equal(legacyResponse.status, 410, "pausing v2 issuance must not reopen legacy booking POST");
  } finally {
    if (previous === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = previous;
  }
});

test("cookie configuration longer than the approved 24-hour window fails closed", async () => {
  const previous = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
  try {
    const { POST, calls } = await harness();
    for (const invalid of ["86401", String(30 * 24 * 60 * 60), "0", "not-a-number"]) {
      process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = invalid;
      const bootstrap = await post(POST, { action: "bootstrap" }, { cookie: null });
      assert.equal(bootstrap.response.status, 503);
      assert.equal(bootstrap.response.headers.get("set-cookie"), null);
      assert.equal((await post(POST, prepare)).response.status, 503);
    }
    assert.deepEqual(calls, []);
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

test("actual oversized JSON body fails closed when Content-Length understates it", async () => {
  const oversized = { ...prepare, fullName: "A".repeat(5000) };
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) > 4096);
  const { POST, calls, quotaCalls } = await harness();
  const { response, value } = await post(POST, oversized, { headers: { "content-length": "1" } });
  assert.equal(response.status, 400);
  assert.deepEqual(value, { error: "invalid_request" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(quotaCalls, []);
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

test("v2 rejects outcomes that belong to a different intent action", async () => {
  const previous = process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "3600";
  try {
    const cases = [
      [prepare, { state: "none", generation }],
      [{ action: "commit", salonSlug: "browser-fixture", intentId },
        { state: "prepared", generation, intent_id: intentId }],
      [{ action: "cancel", salonSlug: "browser-fixture", intentId },
        { state: "prepared", generation, intent_id: intentId }],
      [{ action: "acknowledge", salonSlug: "browser-fixture", intentId },
        { state: "not_committed", generation, intent_id: intentId }],
    ];
    for (const [body, invalidResult] of cases) {
      const { POST, calls } = await harness(true, { data: invalidResult, error: null });
      const { response, value } = await post(POST, body);
      assert.equal(response.status, 503, `${body.action} must reject ${invalidResult.state}`);
      assert.deepEqual(value, { state: "unknown", error: "booking_unavailable" });
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.deepEqual(calls.map(({ name }) => name), [`${body.action}_public_booking_intent`]);
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

test("expired browser session denial stays unknown without minting a replacement cookie", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "86400";
  const { POST, calls } = await harness(true, {
    data: null, error: { code: "P0001", message: "booking_browser_session_expired" },
  });
  for (const body of [
    { action: "reconcile", salonSlug: "browser-fixture", intentId },
    prepare,
  ]) {
    const { response, value } = await post(POST, body);
    assert.equal(response.status, 503);
    assert.deepEqual(value, { state: "unknown", error: "booking_unavailable" });
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.deepEqual(calls.map(({ name }) => name), [
    "reconcile_public_booking_intent", "prepare_public_booking_intent",
  ]);
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

const confirmedIntent = { data: { state: "confirmed", generation, intent_id: intentId, confirmation: {
  appointment_id: otherIntentId, appointment_status: "confirmed",
  confirmed_start: "2030-01-15T10:00:00+00:00", confirmed_end: "2030-01-15T10:30:00+00:00",
  service_title: { fr: "Titre réservé", en: "Booked title", es: "Título reservado" },
  currency: "EUR", saved_locale: "fr", client_email: "fixture@example.invalid",
} }, error: null };

test("v2 enriches only the exact intent-bound appointment with published details and current price", async () => {
  const model = publishedReadModel();
  const { POST } = await harness(true, confirmedIntent, model);
  const { response, value } = await post(POST, { action: "reconcile", salonSlug: "browser-fixture", intentId });
  assert.equal(response.status, 200);
  assert.deepEqual(value.confirmation, {
    appointment_id: otherIntentId, appointment_status: "confirmed",
    confirmed_start: "2030-01-15T10:00:00+00:00", confirmed_end: "2030-01-15T10:30:00+00:00",
    salon_name: "Published Salon", service_title: { fr: "Titre réservé", en: "Booked title", es: "Título reservado" },
    currency: "EUR", saved_locale: "fr",
    details: { time_zone: "Europe/Paris", address: "12 Public Street, Paris, 75001, FR",
      policies: { fr: "Conditions publiques", en: "Published policy", es: "Condiciones públicas" },
      catalog_price: 5200, currency: "EUR",
      service_title: { fr: "Titre réservé", en: "Booked title", es: "Título reservado" } },
  });
  assert.deepEqual(model.reads.map(read => read.table), ["tenants", "appointments", "services", "salon_public_profiles"]);
  assert.deepEqual(model.reads.find(read => read.table === "appointments").filters,
    [["id", otherIntentId], ["tenant_id", "tenant-a"], ["start_time", "2030-01-15T10:00:00+00:00"]]);
  assert.deepEqual(model.reads.find(read => read.table === "services").filters,
    [["id", intentId], ["tenant_id", "tenant-a"]]);
  assert.deepEqual(model.reads.find(read => read.table === "salon_public_profiles").filters,
    [["tenant_id", "tenant-a"], ["is_published", true]]);
  assert.deepEqual(model.reads.find(read => read.table === "services").columns, ["price", "currency"]);
  assert.doesNotMatch(JSON.stringify(value), /SECRET|Changed catalog title|fixture@example.invalid/);
});

for (const [label, changes] of [
  ["wrong tenant", { appointments: [{ id: otherIntentId, tenant_id: "tenant-b", start_time: "2030-01-15T10:00:00+00:00", service_id: intentId }] }],
  ["wrong start", { appointments: [{ id: otherIntentId, tenant_id: "tenant-a", start_time: "2030-01-15T11:00:00+00:00", service_id: intentId }] }],
  ["missing bound service", { services: [] }],
  ["profile read error", { salon_public_profiles: [
    { tenant_id: "tenant-a", is_published: true }, { tenant_id: "tenant-a", is_published: true },
  ] }],
]) {
  test(`v2 ${label} enrichment fails to no-details without changing confirmed identity`, async () => {
    const model = publishedReadModel(changes);
    const { POST } = await harness(true, confirmedIntent, model);
    const { value } = await post(POST, { action: "commit", salonSlug: "browser-fixture", intentId });
    assert.equal(value.state, "confirmed");
    assert.equal(value.confirmation.appointment_id, otherIntentId);
    assert.equal(value.confirmation.details, null);
    assert.equal(value.confirmation.salon_name, "");
    assert.doesNotMatch(JSON.stringify(value), /SECRET|fixture@example.invalid/);
  });
}

test("v2 never reveals an unpublished salon address or policies", async () => {
  const model = publishedReadModel({ salon_public_profiles: [{ tenant_id: "tenant-a", is_published: false,
    business_name: "Hidden Salon", address_line1: "Secret Street", policies_json: { en: "Secret policy" } }] });
  const { POST } = await harness(true, confirmedIntent, model);
  const { value } = await post(POST, { action: "reconcile", salonSlug: "browser-fixture" });
  assert.equal(value.state, "confirmed");
  assert.equal(value.confirmation.salon_name, "");
  assert.equal(value.confirmation.details.address, null);
  assert.deepEqual(value.confirmation.details.policies, {});
  assert.equal(value.confirmation.details.catalog_price, 5200);
  assert.doesNotMatch(JSON.stringify(value), /Hidden Salon|Secret Street|Secret policy/);
});

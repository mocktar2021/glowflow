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

async function harness(enabled = true, rpcResult = { data: { state: "prepared", generation, intent_id: intentId }, error: null }, readModel = null) {
  const calls = [];
  const deps = {
    "@/lib/public-booking-v2-config": { publicBookingV2Enabled: () => enabled },
    "@/lib/supabase/admin": { createAdminClient: () => ({ ...(readModel ? { from: readModel.from } : {}), rpc: async (name, args) => {
      calls.push({ name, args });
      return typeof rpcResult === "function" ? rpcResult(name, args) : rpcResult;
    } }) },
  };
  const { POST } = await load("../app/api/public-booking/v2/route.ts", deps);
  return { calls, POST, deps };
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
    assert.deepEqual((await post(POST, { action: "bootstrap" })).value, { ready: true, new_session: false });
  } finally {
    if (previous === undefined) delete process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS;
    else process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = previous;
  }
});

test("signed cookie proves issue time and host after database session purge", async () => {
  process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "86400";
  const { POST, calls } = await harness();
  const now = Math.floor(Date.now() / 1000);
  for (const stale of [
    signedToken({ issuedAt: now - 86401, expiresAt: now - 1 }),
    signedToken({ issuedAt: now + 60, expiresAt: now + 86460 }),
    signedToken({ issuedAt: now, expiresAt: now + 86401 }),
    `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
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

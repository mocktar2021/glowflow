import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
async function moduleAt(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)((name) => dependencies[name] ?? require(name), loaded, loaded.exports);
  return loaded.exports;
}
const base = await moduleAt("../lib/stripe-sandbox-config.ts");
const config = await moduleAt("../lib/stripe-deposits-config.ts", { "./stripe-sandbox-config": base });
const helpers = await moduleAt("../lib/stripe-deposits.ts");
const now = Date.parse("2026-09-10T12:00:00Z");
const row = { id: "11111111-1111-4111-8111-111111111111", tenant_id: "tenant", appointment_id: "appointment", client_id: "client", service_id: "service", stripe_account_id: "acct_fixture", amount: 1500, currency: "EUR", service_title: { fr: "Coupe" }, locale: "fr", status: "reserved", expires_at: new Date(now + 35 * 60000).toISOString(), checkout_session_id: null, checkout_url: null };
const env = { GLOWFLOW_STRIPE_SANDBOX_ONBOARDING: "true", GLOWFLOW_STRIPE_SANDBOX_DEPOSITS: "true", VERCEL_ENV: "preview", STRIPE_RESTRICTED_KEY: "rk_test_fixture", STRIPE_SANDBOX_ACCOUNT_ID: "acct_1UCiSZDNDjGEQe6f", GLOWFLOW_APP_URL: "https://preview.example.com", NEXT_PUBLIC_SUPABASE_URL: "https://rfwhqutkiztxkagbhevp.supabase.co" };
test("deposits fail closed for production, alternate projects, keys and missing activation", () => {
  assert.ok(config.sandboxDepositConfiguration(env));
  for (const patch of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, { GLOWFLOW_STRIPE_SANDBOX_DEPOSITS: undefined }, { GLOWFLOW_STRIPE_SANDBOX_ONBOARDING: "false" }, { STRIPE_RESTRICTED_KEY: "rk_live_fixture" }, { STRIPE_RESTRICTED_KEY: "sk_test_fixture" }, { STRIPE_SANDBOX_ACCOUNT_ID: "acct_other" }, { NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" }]) assert.equal(config.sandboxDepositConfiguration({ ...env, ...patch }), null);
});
test("stable trusted session parameters correlate both Session and PaymentIntent", () => {
  const first = helpers.sandboxCheckoutParameters(row, env.GLOWFLOW_APP_URL, "salon", now);
  assert.deepEqual(first, helpers.sandboxCheckoutParameters(row, env.GLOWFLOW_APP_URL, "salon", now + 60000));
  assert.equal(first.line_items[0].price_data.unit_amount, 1500);
  assert.equal(first.line_items[0].price_data.currency, "eur");
  assert.deepEqual(first.metadata, first.payment_intent_data.metadata);
  assert.equal(first.metadata.appointment_id, row.appointment_id);
  assert.equal(first.expires_at, Date.parse(row.expires_at) / 1000);
  assert.ok(first.success_url.endsWith(`?sandboxReservation=${row.id}`));
  assert.equal(first.success_url, first.cancel_url);
  assert.equal(first.payment_method_types, undefined);
  assert.equal(first.payment_intent_data.application_fee_amount, undefined);
});
test("ambiguous old attempts, invalid amounts and terminal reservations cannot create checkout", () => {
  for (const patch of [{ amount: 0 }, { amount: 1.5 }, { currency: "eur" }, { status: "paid" }, { expires_at: "invalid" }, { expires_at: new Date(now + 30 * 60000).toISOString() }]) assert.throws(() => helpers.sandboxCheckoutParameters({ ...row, ...patch }, env.GLOWFLOW_APP_URL, "salon", now));
});
test("merchant identity and active v2 capability must all match", () => {
  const account = { id: row.stripe_account_id, livemode: false, metadata: { tenant_id: row.tenant_id, product: "glowflow", environment: "sandbox" }, configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } } };
  assert.doesNotThrow(() => helpers.assertSandboxMerchant(account, row));
  for (const patch of [{ livemode: true }, { id: "acct_other" }, { metadata: { ...account.metadata, tenant_id: "other" } }, { metadata: { ...account.metadata, environment: "live" } }, { configuration: {} }]) assert.throws(() => helpers.assertSandboxMerchant({ ...account, ...patch }, row));
});
test("safe result excludes client information and hides terminal checkout URL", () => {
  const pending = { ...row, status: "pending", checkout_url: "https://checkout.stripe.com/c/pay/test", full_name: "Private" };
  assert.deepEqual(Object.keys(helpers.safeSandboxReservation(pending, now)), ["reservationId", "status", "expiresAt", "url"]);
  assert.equal(helpers.safeSandboxReservation(pending, now + 36 * 60000).status, "expired");
  assert.equal(helpers.safeSandboxReservation(pending, now + 36 * 60000).url, null);
  assert.equal(helpers.safeSandboxReservation({ ...pending, status: "paid" }, now + 36 * 60000).status, "paid");
});

async function routeHarness({ owner = true, tenantMatches = true, configEnabled = true, reserveRow = row, attachError = false } = {}) {
  let calls = [];
  const client = { auth: { getUser: async () => ({ data: { user: owner ? { id: "owner" } : null } }) }, from: (table) => {
    const query = { select: () => query, eq: () => query, single: async () => ({ data: table === "tenants" ? (tenantMatches ? { id: row.tenant_id, slug: "salon" } : null) : { ...reserveRow, private_note: "secret" } }) }; return query;
  } };
  const route = await moduleAt("../app/api/checkout/route.ts", {
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/supabase/admin": { createAdminClient: () => { calls.push("admin"); return { rpc: async (name, args) => { calls.push({ name, args }); return name.startsWith("reserve") ? { data: reserveRow } : attachError ? { error: {} } : { data: { ...reserveRow, status: "pending", checkout_url: "https://checkout.stripe.com/c/pay/test" } }; } }; } },
    "@/lib/stripe": { createStripeClient: () => { calls.push("stripe"); return { accounts: { retrieve: async () => ({ id: env.STRIPE_SANDBOX_ACCOUNT_ID }) }, v2: { core: { accounts: { retrieve: async () => ({ id: row.stripe_account_id, livemode: false, metadata: { tenant_id: row.tenant_id, environment: "sandbox", product: "glowflow" }, configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } } }) } } }, checkout: { sessions: { create: async (params, options) => { calls.push({ params, options }); return { id: "cs_test_fixture", livemode: false, url: "https://checkout.stripe.com/c/pay/test", metadata: params.metadata, amount_total: row.amount, currency: "eur" }; } } } }; } },
    "@/lib/stripe-deposits-config": { sandboxDepositConfiguration: () => configEnabled ? { origin: env.GLOWFLOW_APP_URL, platformAccountId: env.STRIPE_SANDBOX_ACCOUNT_ID } : null },
    "@/lib/stripe-deposits": helpers,
  });
  return { route, calls };
}
const input = { salonSlug: "salon", serviceId: row.id, staffId: row.id, startTime: "2026-09-12T12:00:00Z", fullName: "Test Owner", phone: "123", email: "", locale: "fr", requestKey: row.id };
function request(body = input) { return new Request("https://preview.example.com/api/checkout", { method: "POST", body: JSON.stringify(body) }); }
test("route rejects forged trusted fields and anonymous requests before privileged calls", async () => {
  for (const patch of [{ amount: 1 }, { stripeAccount: "acct_other" }]) {
    const h = await routeHarness(); assert.equal((await h.route.POST(request({ ...input, ...patch }))).status, 400); assert.deepEqual(h.calls, []);
  }
  const h = await routeHarness({ owner: false }); assert.equal((await h.route.POST(request())).status, 403); assert.deepEqual(h.calls, []);
  const disabled = await routeHarness({ configEnabled: false }); assert.equal((await disabled.route.POST(request())).status, 503); assert.deepEqual(disabled.calls, []);
});
test("checkout persists before Stripe, reuses reservation idempotency and scoped account", async () => {
  const current = { ...row, expires_at: new Date(Date.now() + 35 * 60000).toISOString() };
  const h = await routeHarness({ reserveRow: current });
  const response = await h.route.POST(request()); assert.equal(response.status, 200);
  const sessionIndex = h.calls.findIndex((call) => call.params);
  assert.ok(h.calls.findIndex((call) => call.name?.startsWith("reserve")) < sessionIndex);
  assert.equal(h.calls[sessionIndex].options.stripeAccount, row.stripe_account_id);
  assert.equal(h.calls[sessionIndex].options.idempotencyKey, `glowflow-sandbox-deposit-${row.id}`);
  assert.equal((await response.json()).status, "pending");
});
test("attached checkout retries create no second session and persistence failure is retryable", async () => {
  const current = { ...row, status: "pending", expires_at: new Date(Date.now() + 35 * 60000).toISOString(), checkout_url: "https://checkout.stripe.com/c/pay/test" };
  const h = await routeHarness({ reserveRow: current }); assert.equal((await h.route.POST(request())).status, 200); assert.equal(h.calls.filter((call) => call.params).length, 0);
  const failed = await routeHarness({ reserveRow: { ...current, status: "reserved" }, attachError: true });
  assert.equal((await failed.route.POST(request())).status, 503);
});

test("owner mismatch and malformed JSON do not reach privileged services", async () => {
  const mismatch = await routeHarness({ tenantMatches: false });
  assert.equal((await mismatch.route.POST(request())).status, 403);
  assert.deepEqual(mismatch.calls, []);
  const malformed = await routeHarness();
  assert.equal((await malformed.route.POST(new Request("https://preview.example.com/api/checkout", { method: "POST", body: "{" }))).status, 400);
  assert.deepEqual(malformed.calls, []);
});
test("GET exposes only owner-scoped reservation summary without privileged clients", async () => {
  const h = await routeHarness({ reserveRow: { ...row, status: "paid" } });
  const response = await h.route.GET(new Request(`https://preview.example.com/api/checkout?reservationId=${row.id}`));
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(await response.json()), ["reservationId", "status", "expiresAt", "url"]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(h.calls, []);
  const anonymous = await routeHarness({ owner: false });
  assert.equal((await anonymous.route.GET(new Request(`https://preview.example.com/api/checkout?reservationId=${row.id}`))).status, 403);
});

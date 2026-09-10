import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import Stripe from "stripe";

const compile = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const helperUrl = compile(await readFile(new URL("../lib/stripe-deposit-events.ts", import.meta.url), "utf8"));
const { sandboxDepositEventArguments } = await import(helperUrl);
const id = "11111111-1111-4111-8111-111111111111";
function event(type = "checkout.session.completed") {
  return { id: "evt_fixture", account: "acct_connected", type, livemode: false, data: { object: {
    id: "cs_test_fixture", object: "checkout.session", mode: "payment", livemode: false,
    payment_status: "paid", payment_intent: "pi_fixture", amount_total: 2500, currency: "eur",
    metadata: { tenant_id: id, appointment_id: id, client_id: id, reservation_id: id, environment: "sandbox", product: "glowflow" },
  } } };
}

test("only settled Checkout completion and async success can reach the settlement RPC", () => {
  for (const type of ["checkout.session.completed", "checkout.session.async_payment_succeeded"]) {
    const value = event(type);
    assert.equal(sandboxDepositEventArguments(value).target_event_type, type);
    for (const status of ["unpaid", "no_payment_required", undefined]) {
      value.data.object.payment_status = status;
      assert.equal(sandboxDepositEventArguments(value), null);
    }
  }
});
test("expiry and async failure retain exact identifiers and allow no payment intent", () => {
  for (const type of ["checkout.session.expired", "checkout.session.async_payment_failed"]) {
    const value = event(type);
    value.data.object.payment_status = "unpaid";
    value.data.object.payment_intent = null;
    const args = sandboxDepositEventArguments(value);
    assert.equal(args.target_event_type, type);
    assert.equal(args.target_payment_intent_id, null);
    assert.equal(args.target_amount, 2500);
    assert.equal(args.target_account_id, "acct_connected");
  }
});
test("wrong mode, malformed metadata, money and missing account never reach RPC", () => {
  const changes = [
    v => v.livemode = true, v => delete v.account,
    v => v.data.object.livemode = true, v => v.data.object.mode = "subscription",
    v => v.type = "payment_intent.succeeded", v => v.data.object.id = "cs_live_fixture",
    v => v.data.object.metadata.environment = "production", v => v.data.object.metadata.product = "other",
    ...["tenant_id", "appointment_id", "client_id", "reservation_id"].map(key => v => delete v.data.object.metadata[key]),
    v => v.data.object.amount_total = 0, v => v.data.object.amount_total = 1.5,
    v => v.data.object.currency = "EUR", v => v.data.object.payment_intent = null,
  ];
  for (const change of changes) { const value = event(); change(value); assert.equal(sandboxDepositEventArguments(value), null); }
});

const stripe = new Stripe("rk_test_fixture");
const secret = "whsec_runtime_fixture";
let enabled = true;
let result = { error: null };
let calls = [];
globalThis.__depositWebhookMocks = {
  stripe,
  configuration: () => enabled ? {} : null,
  admin: () => ({ rpc: async (...args) => { calls.push(args); if (result instanceof Error) throw result; return result; } }),
};
let routeSource = await readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8");
routeSource = routeSource
  .replace('import { createAdminClient } from "@/lib/supabase/admin";', 'const createAdminClient = globalThis.__depositWebhookMocks.admin;')
  .replace('import { createStripeClient } from "@/lib/stripe";', 'const createStripeClient = () => globalThis.__depositWebhookMocks.stripe;')
  .replace('import { sandboxDepositConfiguration } from "@/lib/stripe-deposits-config";', 'const sandboxDepositConfiguration = globalThis.__depositWebhookMocks.configuration;')
  .replace('"@/lib/stripe-deposit-events"', JSON.stringify(helperUrl));
const { POST } = await import(compile(routeSource));
function request(value = event(), signingSecret = secret, tamper = false) {
  const body = JSON.stringify(value, null, 2);
  const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: signingSecret });
  return new Request("https://preview.example/api/stripe/webhook", { method: "POST", body: tamper ? body + " " : body, headers: { "stripe-signature": signature } });
}
test("route verifies exact raw bytes with dedicated secret and calls only atomic RPC", async () => {
  process.env.STRIPE_SANDBOX_WEBHOOK_SECRET = secret;
  calls = [];
  assert.equal((await POST(request())).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "process_stripe_sandbox_event");
  assert.deepEqual(calls[0][1], sandboxDepositEventArguments(event()));
  for (const req of [request(event(), "whsec_wrong"), request(event(), secret, true), new Request("https://preview.example", { method: "POST", body: "{}" })]) {
    assert.equal((await POST(req)).status, 400);
  }
  assert.equal(calls.length, 1);
});
test("disabled preview configuration rejects processing and ignores unrelated signed events", async () => {
  calls = [];
  enabled = false;
  assert.equal((await POST(request())).status, 503);
  enabled = true;
  assert.equal((await POST(request(event("payment_intent.succeeded")))).status, 200);
  assert.equal(calls.length, 0);
});
test("database failure and correlation rejection are retryable and never acknowledged", async () => {
  for (const failure of [{ error: { code: "08006", message: "private database details" } }, { error: { code: "22023" } }, new Error("private server details")]) {
    result = failure;
    const response = await POST(request());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "event_processing_failed" });
  }
  result = { error: null };
  assert.equal((await POST(request())).status, 200);
});

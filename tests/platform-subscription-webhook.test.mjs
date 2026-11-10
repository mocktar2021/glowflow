import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const Stripe = require("stripe");
const stripe = new Stripe("unused");
const secret = `whsec_${"fixtureOnly"}`;
const source = await readFile(new URL("../lib/billing/platform-subscription-webhook.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)(require, loaded, loaded.exports);
const { inspectPlatformSubscriptionWebhook } = loaded.exports;

function event(overrides = {}) {
  return {
    id: "evt_fixtureOne", type: "customer.subscription.updated",
    livemode: false, created: 1794260000,
    data: { object: {
      object: "subscription", id: "sub_fixtureOne", customer: "cus_fixtureOne",
      livemode: false, status: "active",
    } },
    ...overrides,
  };
}

function signed(input) {
  const raw = JSON.stringify(input);
  const header = stripe.webhooks.generateTestHeaderString({ payload: raw, secret });
  return inspectPlatformSubscriptionWebhook(raw, header, secret, false, stripe);
}

test("dedicated platform signature is required before reading subscription fields", () => {
  const raw = JSON.stringify(event());
  const header = stripe.webhooks.generateTestHeaderString({ payload: raw, secret });
  assert.equal(inspectPlatformSubscriptionWebhook(raw, header, undefined, false, stripe).kind, "unavailable");
  assert.equal(inspectPlatformSubscriptionWebhook(raw, header, secret, "false", stripe).kind, "unavailable");
  assert.equal(inspectPlatformSubscriptionWebhook(raw, null, secret, false, stripe).kind, "invalid_signature");
  assert.equal(inspectPlatformSubscriptionWebhook(`${raw} `, header, secret, false, stripe).kind, "invalid_signature");
  assert.equal(inspectPlatformSubscriptionWebhook(raw, header, `whsec_${"wrong"}`, false, stripe).kind, "invalid_signature");
  assert.equal(inspectPlatformSubscriptionWebhook(" ".repeat(1024 * 1024 + 1), header, secret, false, stripe).kind, "invalid_signature");
});

test("verified platform subscription event retains first-class Stripe IDs, not metadata", () => {
  const decision = signed(event({ data: { object: {
    object: "subscription", id: "sub_fixtureOne", customer: "cus_fixtureOne",
    livemode: false, status: "trialing", metadata: { tenant_id: "wrong-tenant" },
  } } }));
  assert.deepEqual(decision, {
    kind: "subscription_event", eventId: "evt_fixtureOne",
    eventType: "customer.subscription.updated", created: 1794260000,
    customerId: "cus_fixtureOne", subscriptionId: "sub_fixtureOne",
    status: "trialing", livemode: false,
  });
  assert.ok(Object.isFrozen(decision));
});

test("all three subscription lifecycle event types are classified", () => {
  for (const type of ["customer.subscription.created", "customer.subscription.updated",
    "customer.subscription.deleted"]) {
    assert.equal(signed(event({ type })).kind, "subscription_event");
  }
});

test("wrong platform scope or Stripe mode retries, never acknowledges", () => {
  for (const input of [event({ account: "acct_connected" }), event({ livemode: true })]) {
    assert.deepEqual(signed(input), { kind: "retry", reason: "identity_or_mode_mismatch" });
  }
  assert.deepEqual(signed(event({ data: { object: {
    object: "subscription", id: "sub_fixtureOne", customer: "cus_fixtureOne",
    livemode: true, status: "active",
  } } })), { kind: "retry", reason: "malformed_event" });
});

test("signed but malformed subscription events retry", () => {
  for (const input of [event({ id: "bad" }), event({ created: -1 }),
    event({ data: { object: null } }),
    event({ data: { object: { object: "invoice", id: "sub_fixtureOne", customer: "cus_fixtureOne", livemode: false, status: "active" } } }),
    event({ data: { object: { object: "subscription", id: "bad", customer: "cus_fixtureOne", livemode: false, status: "active" } } }),
    event({ data: { object: { object: "subscription", id: "sub_fixtureOne", customer: { id: "cus_fixtureOne" }, livemode: false, status: "active" } } }),
    event({ data: { object: { object: "subscription", id: "sub_fixtureOne", customer: "cus_fixtureOne", livemode: false, status: "unexpected" } } })]) {
    assert.deepEqual(signed(input), { kind: "retry", reason: "malformed_event" });
  }
});

test("every signed event outside the reviewed lifecycle allowlist retries", () => {
  for (const type of [
    "checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_failed",
    "invoice.created", "invoice.finalized", "invoice.paid", "invoice.payment_failed",
    "invoice.payment_action_required", "charge.dispute.created", "charge.dispute.closed",
    "charge.refunded", "charge.failed", "refund.updated", "payment_intent.succeeded",
    "radar.early_fraud_warning.created", "radar.early_fraud_warning.updated",
    "customer.updated", "product.updated", "future.payment.event",
  ]) {
    assert.deepEqual(signed(event({ type })), { kind: "retry", reason: "unhandled_event" });
  }
});

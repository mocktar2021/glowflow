import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = await readFile(new URL("../lib/billing/subscription-contract.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)(require, loaded, loaded.exports);
const { validateSalonSubscriptionCatalog, selectSalonSubscriptionPlan } = loaded.exports;

const us = Object.freeze({
  planKey: "fixture_small", countryCode: "US", currency: "USD",
  maxTeamMembers: 3, includedSms: 0, includedWhatsApp: 0,
  stripePriceId: "price_testFixtureUs",
});
const fr = Object.freeze({
  ...us, countryCode: "FR", currency: "EUR", stripePriceId: "price_testFixtureFr",
});
const context = Object.freeze({ countryCode: "US", currency: "USD", activeTeamMembers: 2 });

test("no default plan or incomplete catalog can select a subscription", () => {
  for (const catalog of [undefined, null, [], {}, [null], [{ ...us, stripePriceId: undefined }]]) {
    assert.equal(validateSalonSubscriptionCatalog(catalog), null);
    assert.equal(selectSalonSubscriptionPlan(catalog, { planKey: us.planKey }, context), null);
  }
});

test("trusted plans are selected only by exact tenant market and seat count", () => {
  const catalog = [us, fr];
  assert.deepEqual(selectSalonSubscriptionPlan(catalog, { planKey: us.planKey }, context), us);
  assert.deepEqual(selectSalonSubscriptionPlan(catalog, { planKey: fr.planKey }, {
    countryCode: "FR", currency: "EUR", activeTeamMembers: 3,
  }), fr);
  for (const patch of [
    { countryCode: "CA" }, { currency: "EUR" }, { activeTeamMembers: 4 },
    { activeTeamMembers: -1 }, { activeTeamMembers: 1.5 },
  ]) assert.equal(selectSalonSubscriptionPlan(catalog, { planKey: us.planKey }, { ...context, ...patch }), null);
  assert.equal(selectSalonSubscriptionPlan(catalog, { planKey: "unknown" }, context), null);
});

test("browser cannot supply a Price ID, amount, market or extra field", () => {
  for (const request of [
    { planKey: us.planKey, stripePriceId: us.stripePriceId },
    { planKey: us.planKey, amount: 1 },
    { planKey: us.planKey, countryCode: "FR" },
    { planKey: us.planKey, currency: "EUR" },
    { planKey: us.planKey, activeTeamMembers: 0 },
    { priceId: us.stripePriceId },
    us.planKey,
  ]) assert.equal(selectSalonSubscriptionPlan([us], request, context), null);
});

test("ambiguous, malformed and polluted catalogs fail closed", () => {
  for (const catalog of [
    [us, { ...us }],
    [us, { ...fr, stripePriceId: us.stripePriceId }],
    [{ ...us, amount: 1 }],
    [{ ...us, maxTeamMembers: 0 }],
    [{ ...us, includedSms: -1 }],
    [{ ...us, includedWhatsApp: 1.5 }],
    [{ ...us, countryCode: "us" }],
    [{ ...us, currency: "usd" }],
    [{ ...us, stripePriceId: "cs_test_not_a_price" }],
    [{ ...us, planKey: "" }],
  ]) assert.equal(validateSalonSubscriptionCatalog(catalog), null);
});

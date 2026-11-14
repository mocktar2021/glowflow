import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");

async function loadModule(path, imports = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (name) => imports[name] ?? require(name), loaded, loaded.exports,
  );
  return loaded.exports;
}

const offer = await loadModule("../lib/billing/starter-offer.ts");
const pricePreflight = await loadModule(
  "../lib/billing/starter-checkout-preflight.ts", { "./starter-offer": offer },
);
const { reviewStarterProductEvidence } = await loadModule(
  "../lib/billing/starter-product-preflight.ts",
  { "./starter-checkout-preflight": pricePreflight },
);

const product = (overrides = {}) => ({
  object: "product", id: "prod_fixtureStarter", active: true,
  livemode: false, name: "GlowFlow Starter", tax_code: "txcd_12345678",
  ...overrides,
});
const price = (overrides = {}) => ({
  object: "price", id: "price_fixtureStarter", active: true,
  livemode: false, currency: "usd", unit_amount: 2999,
  billing_scheme: "per_unit", type: "recurring", tax_behavior: "exclusive",
  recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  product: product(), ...overrides,
});
const review = (observed = price(), options = {}) => reviewStarterProductEvidence(
  options.countryCode ?? "US",
  options.configuredPriceId ?? "price_fixtureStarter",
  options.configuredProductId ?? "prod_fixtureStarter",
  options.configuredProductName ?? "GlowFlow Starter",
  options.approvedTaxCodeId ?? "txcd_12345678",
  options.expectedLivemode ?? false,
  observed,
);

test("reviewed Starter Price is bound to the exact active Product and tax code", () => {
  const result = review();
  assert.deepEqual(result, {
    priceId: "price_fixtureStarter", countryCode: "US", currency: "USD",
    monthlyPriceBeforeTaxMinorUnits: 2999, livemode: false,
    productId: "prod_fixtureStarter", productName: "GlowFlow Starter",
    taxCodeId: "txcd_12345678",
  });
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(review(price({ currency: "eur", unit_amount: 2499 }), {
    countryCode: "FR",
  })?.productId, "prod_fixtureStarter");
});

test("wrong or unexpanded Product and unreviewed tax treatment fail closed", () => {
  for (const observed of [
    price({ product: "prod_fixtureStarter" }),
    price({ product: null }),
    price({ product: product({ object: "customer" }) }),
    price({ product: product({ id: "prod_other" }) }),
    price({ product: product({ active: false }) }),
    price({ product: product({ livemode: true }) }),
    price({ product: product({ name: "Other product" }) }),
    price({ product: product({ tax_code: null }) }),
    price({ product: product({ tax_code: "txcd_99999999" }) }),
    price({ unit_amount: 1999 }),
    price({ currency: "eur" }),
  ]) assert.equal(review(observed), null);
});

test("untrusted configuration and mode cannot select a fallback Product", () => {
  for (const options of [
    { configuredPriceId: "price_other" },
    { configuredProductId: "prod_other" },
    { configuredProductId: "__proto__" },
    { configuredProductName: "Other product" },
    { configuredProductName: " GlowFlow Starter" },
    { approvedTaxCodeId: "" },
    { approvedTaxCodeId: "txcd_other" },
    { approvedTaxCodeId: "txcd_99999999" },
    { expectedLivemode: true },
    { countryCode: "DE" },
  ]) assert.equal(review(price(), options), null);
});

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
const { reviewStarterPriceEvidence, nextCalendarMonthTrialEndDate } = await loadModule(
  "../lib/billing/starter-checkout-preflight.ts", { "./starter-offer": offer },
);

function price(overrides = {}) {
  return {
    object: "price", id: "price_fixtureStarter", active: true,
    livemode: false, currency: "usd", unit_amount: 2999,
    billing_scheme: "per_unit", type: "recurring", tax_behavior: "exclusive",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    ...overrides,
  };
}

test("reviewed Starter Price must match the exact market, amount, and mode", () => {
  const us = reviewStarterPriceEvidence("US", "price_fixtureStarter", false, price());
  assert.deepEqual(us, {
    priceId: "price_fixtureStarter", countryCode: "US", currency: "USD",
    monthlyPriceBeforeTaxMinorUnits: 2999, livemode: false,
  });
  assert.ok(Object.isFrozen(us));
  for (const countryCode of ["FR", "ES", "BE", "LU"]) {
    assert.deepEqual(reviewStarterPriceEvidence(countryCode, "price_fixtureStarter", false,
      price({ currency: "eur", unit_amount: 2499 })), {
      priceId: "price_fixtureStarter", countryCode, currency: "EUR",
      monthlyPriceBeforeTaxMinorUnits: 2499, livemode: false,
    });
  }
});

test("missing, inactive, mismatched, or underpriced Stripe evidence fails closed", () => {
  for (const observed of [null, {}, price({ id: "price_other" }),
    price({ active: false }), price({ livemode: true }), price({ currency: "eur" }),
    price({ unit_amount: 1999 }), price({ unit_amount: 0 }),
    price({ billing_scheme: "tiered" }), price({ type: "one_time" }),
    price({ tax_behavior: "inclusive" }), price({ tax_behavior: "unspecified" }),
    price({ transform_quantity: { divide_by: 2, round: "up" } }),
    price({ custom_unit_amount: { enabled: true } }),
    price({ recurring: null }), price({ recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } }),
    price({ recurring: { interval: "month", interval_count: 2, usage_type: "licensed" } }),
    price({ recurring: { interval: "month", interval_count: 1, usage_type: "metered" } }),
    price({ recurring: { interval: "month", interval_count: 1, usage_type: "licensed", trial_period_days: 30 } })]) {
    assert.equal(reviewStarterPriceEvidence("US", "price_fixtureStarter", false, observed), null);
  }
  assert.equal(reviewStarterPriceEvidence("US", "price_fixtureStarter", true, price()), null);
});

test("untrusted or unsupported market and Price ID never select a fallback", () => {
  for (const countryCode of ["CA", "DE", "us", "", null, {}, "__proto__"]) {
    assert.equal(reviewStarterPriceEvidence(countryCode, "price_fixtureStarter", false, price()), null);
  }
  for (const configuredPriceId of [null, "", "cs_fixture", "price_fixture-Starter", "__proto__"]) {
    assert.equal(reviewStarterPriceEvidence("US", configuredPriceId, false, price()), null);
  }
  assert.equal(reviewStarterPriceEvidence("US", "price_fixtureStarter", "false", price()), null);
});

test("calendar-month trial date clamps missing dates, including leap years", () => {
  for (const [start, end] of [
    ["2026-01-31", "2026-02-28"], ["2028-01-31", "2028-02-29"],
    ["2026-03-31", "2026-04-30"], ["2026-04-30", "2026-05-30"],
    ["2026-12-31", "2027-01-31"], ["2026-10-09", "2026-11-09"],
  ]) assert.equal(nextCalendarMonthTrialEndDate(start), end);
});

test("invalid or ambiguous trial dates fail closed", () => {
  for (const input of [null, {}, "2026-02-29", "2026-13-01", "2026-00-01",
    "2026-04-31", "2026-1-9", "2026-01-01T00:00:00Z", "1999-12-31", "9999-12-31"])
    assert.equal(nextCalendarMonthTrialEndDate(input), null);
});

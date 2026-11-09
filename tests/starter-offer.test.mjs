import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = await readFile(new URL("../lib/billing/starter-offer.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)(require, loaded, loaded.exports);
const { approvedStarterOffer } = loaded.exports;

test("Starter has the exact owner-approved US and four euro-area launch markets", () => {
  assert.deepEqual(approvedStarterOffer("US"), {
    countryCode: "US", currency: "USD", monthlyPriceBeforeTaxMinorUnits: 2999,
    maxActivePeople: 3, trialCalendarMonths: 1,
    trialMissingDate: "last_day_of_next_month", paymentMethodRequiredBeforeTrial: true,
  });
  for (const countryCode of ["FR", "ES", "BE", "LU"]) {
    assert.deepEqual(approvedStarterOffer(countryCode), {
      countryCode, currency: "EUR", monthlyPriceBeforeTaxMinorUnits: 2499,
      maxActivePeople: 3, trialCalendarMonths: 1,
      trialMissingDate: "last_day_of_next_month", paymentMethodRequiredBeforeTrial: true,
    });
  }
});

test("unsupported, malformed and inherited market keys fail closed", () => {
  for (const market of ["DE", "NL", "IT", "PT", "GB", "CA", "us", "", "USA", null,
    undefined, 0, {}, "constructor", "__proto__"]) {
    assert.equal(approvedStarterOffer(market), null);
  }
});

test("approved offer data cannot be modified at runtime", () => {
  const us = approvedStarterOffer("US");
  assert.ok(Object.isFrozen(us));
  assert.throws(() => { us.monthlyPriceBeforeTaxMinorUnits = 1; }, TypeError);
  assert.equal(approvedStarterOffer("US").monthlyPriceBeforeTaxMinorUnits, 2999);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = await readFile(new URL("../lib/billing/eu-vat-evidence.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)(require, loaded, loaded.exports);
const { verifiedEuVatTaxIdForBillingCountry, hasVerifiedReverseChargeEvidence } = loaded.exports;

const countries = ["FR", "ES", "BE", "LU"];
const taxId = (country, status = "verified") => ({
  id: `txi_fixture${country}`, type: "eu_vat", value: `${country}123456789`,
  verification: { status },
});

test("only one Stripe-VIES-verified tax ID for the buyer's billing country passes", () => {
  for (const country of countries) {
    const current = taxId(country);
    assert.equal(verifiedEuVatTaxIdForBillingCountry(country, [current]), current.id);
    assert.equal(verifiedEuVatTaxIdForBillingCountry(country, [taxId("FR"), taxId("ES"), taxId("BE"), taxId("LU")]), current.id);
    assert.equal(verifiedEuVatTaxIdForBillingCountry(country.toLowerCase(), [current]), null);
  }
  assert.equal(verifiedEuVatTaxIdForBillingCountry("US", [taxId("FR")]), null);
});

test("uncertain or malformed tax IDs fail closed without leaking the number", () => {
  for (const status of ["pending", "unverified", "unavailable", null]) {
    assert.equal(verifiedEuVatTaxIdForBillingCountry("FR", [taxId("FR", status)]), null);
  }
  for (const candidate of [
    { ...taxId("FR"), id: "not_a_stripe_tax_id" },
    { ...taxId("FR"), type: "us_ein" },
    { ...taxId("FR"), value: "BE123456789" },
    { ...taxId("FR"), value: "FR<script>" },
    { ...taxId("FR"), verification: null },
    { ...taxId("FR"), verification: {} },
  ]) assert.equal(verifiedEuVatTaxIdForBillingCountry("FR", [candidate]), null);
  for (const ids of [null, {}, [], [taxId("FR"), taxId("FR")]]) {
    assert.equal(verifiedEuVatTaxIdForBillingCountry("FR", ids), null);
  }
});

test("a Stripe tax calculation must explicitly say reverse_charge", () => {
  const ids = [taxId("FR")];
  assert.equal(hasVerifiedReverseChargeEvidence("FR", ids, "reverse_charge"), true);
  for (const reason of ["not_collecting", "standard_rated", "customer_exempt", null, 0]) {
    assert.equal(hasVerifiedReverseChargeEvidence("FR", ids, reason), false);
  }
  assert.equal(hasVerifiedReverseChargeEvidence("FR", [taxId("FR", "pending")], "reverse_charge"), false);
  assert.equal(hasVerifiedReverseChargeEvidence("US", ids, "reverse_charge"), false);
});

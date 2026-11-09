import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { authCopy } from "../lib/auth-copy.ts";

const page = readFileSync(new URL("../app/[locale]/register/page.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("../components/glowflow/registration-form.tsx", import.meta.url), "utf8");

test("registration collects account essentials before salon details in one final signup", () => {
  assert.match(page, /<RegistrationForm locale=\{locale\} markets=\{markets\} action=\{signUp\.bind\(null, locale\)\}/);
  assert.match(form, /type="button" onClick=\{continueToSalon\}/);
  assert.match(form, /field\.reportValidity\(\)/);
  assert.match(form, /event\.key === "Enter"/);
  assert.match(form, /hidden=\{step !== 1\}/);
  assert.match(form, /hidden=\{step !== 2\}/);
  assert.match(form, /<CountryFields locale=\{locale\} markets=\{markets\} \/>/);
  assert.equal((form.match(/type="submit"/g) ?? []).length, 1);
  assert.doesNotMatch(form, /stripe|checkout|payment[_-]method/i);
});

test("FR/EN/ES explain benefits and distinguish planned Starter prices from live billing", () => {
  for (const locale of ["fr", "en", "es"]) {
    const copy = authCopy[locale].register;
    for (const key of ["progress", "accountStep", "salonStep", "accountBenefit", "salonBenefit", "continue", "back", "pricingTitle", "pricingPreview", "pricingNotActive"]) {
      assert.ok(copy[key].length > 0, `${locale}.${key} must be present`);
    }
    assert.ok(copy.accountBenefit.length > 20 && copy.salonBenefit.length > 20);
    assert.match(copy.pricingPreview, /29[,.]99/);
    assert.match(copy.pricingPreview, /24[,.]99/);
    assert.doesNotMatch(copy.pricingPreview, /(?:19|14)[,.]99/);
    assert.doesNotMatch(Object.values(copy).join(" "), /\u2014/);
  }
});

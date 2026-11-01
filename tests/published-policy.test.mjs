import assert from "node:assert/strict";
import test from "node:test";

import { selectPublishedPolicy } from "../lib/published-policy.ts";

test("selects the visitor's language when the salon has published it", () => {
  const policies = { fr: "Conditions françaises", en: "English policy", es: "Política española" };
  for (const locale of ["fr", "en", "es"]) {
    assert.deepEqual(selectPublishedPolicy(policies, locale), { text: policies[locale], language: locale });
  }
});

test("uses an available published language when the selected language is absent", () => {
  assert.deepEqual(selectPublishedPolicy({ fr: "  Conditions françaises  " }, "en"), {
    text: "Conditions françaises", language: "fr",
  });
  assert.deepEqual(selectPublishedPolicy({ en: "English policy" }, "es"), {
    text: "English policy", language: "en",
  });
});

test("never treats blank or malformed policy data as published terms", () => {
  for (const value of [null, [], { fr: "   ", en: 42 }, "Free cancellation", {}]) {
    assert.equal(selectPublishedPolicy(value, "fr"), null);
  }
});

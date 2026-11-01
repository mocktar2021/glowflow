import assert from "node:assert/strict";
import test from "node:test";

import { clientFields, clientIdSchema, searchSchema } from "../lib/client-validation.ts";

function data(values) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

const valid = { full_name: "Synthetic Alice", email: "alice@example.invalid", phone: "+1 (555) 010-1234", notes: "Synthetic only", preferred_locale: "fr" };

test("client contact and language validation accepts an international phone and optional contact", () => {
  assert.equal(clientFields(data(valid)).success, true);
  assert.equal(clientFields(data({ ...valid, phone: "", email: "", preferred_locale: "es" })).success, true);
});

test("client contact validation rejects malformed or oversized inputs", () => {
  for (const fields of [
    { ...valid, full_name: "A" },
    { ...valid, email: "not-an-email" },
    { ...valid, phone: "123" },
    { ...valid, phone: "+1 555 010 1234 ext 9" },
    { ...valid, notes: "x".repeat(2001) },
    { ...valid, preferred_locale: "de" },
  ]) assert.equal(clientFields(data(fields)).success, false);
});

test("search is bounded, supports names and email, and rejects wildcard injection", () => {
  assert.equal(searchSchema.safeParse("O'Brien").success, true);
  assert.equal(searchSchema.safeParse("alice@example.invalid").success, true);
  for (const term of ["%", "_", "\\", "a,b", "x".repeat(81)]) assert.equal(searchSchema.safeParse(term).success, false);
  assert.equal(clientIdSchema.safeParse("30000000-0000-0000-0000-000000000001").success, true);
  assert.equal(clientIdSchema.safeParse("../tenant-b").success, false);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { readNailPreferences } from "../lib/nail-preferences.ts";

test("reads only supported plain-text nail preferences", () => {
  assert.deepEqual(readNailPreferences({
    shape: "  Almond  ", product_type: "Gel", shade: "Rose gold",
    design_notes: "Floral design", last_infill_date: "2030-06-01",
    photo_url: "https://example.invalid/private.jpg", hidden: { secret: "private" },
  }), {
    shape: "Almond", productType: "Gel", shade: "Rose gold",
    designNotes: "Floral design", lastInfillDate: "2030-06-01",
  });
});

test("ignores malformed values and invalid calendar dates", () => {
  for (const value of [null, [], "secret", 7]) assert.deepEqual(readNailPreferences(value), {});
  assert.deepEqual(readNailPreferences({
    shape: ["not text"], product_type: { nested: "not text" },
    shade: " \n ", design_notes: 42, last_infill_date: "2030-02-30",
  }), { shape: undefined, productType: undefined, shade: undefined, designNotes: undefined, lastInfillDate: undefined });
  assert.equal(readNailPreferences({ last_infill_date: "2030-06-01extra" }).lastInfillDate, undefined);
});

test("bounds untrusted text and never interprets markup", () => {
  const html = "<img src=x onerror=alert(1)>";
  const result = readNailPreferences({ shape: "A".repeat(200), design_notes: html + "B".repeat(1000) });
  assert.equal(result.shape?.length, 80);
  assert.equal(result.designNotes?.length, 500);
  assert.ok(result.designNotes?.startsWith(html));
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { landingCopy } from "../lib/landing-copy.ts";

const pagePath = new URL("../app/[locale]/page.tsx", import.meta.url);
const rootPath = new URL("../app/(root)/page.tsx", import.meta.url);

function shape(value) {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]));
  return typeof value;
}

test("landing content has the same structure in French, English, and Spanish", () => {
  assert.deepEqual(shape(landingCopy.fr), shape(landingCopy.en));
  assert.deepEqual(shape(landingCopy.fr), shape(landingCopy.es));
  for (const locale of ["fr", "en", "es"]) {
    assert.ok(landingCopy[locale].hero.title.length > 20);
    assert.equal(landingCopy[locale].product.features.length, 3);
    assert.equal(landingCopy[locale].faq.items.length, 3);
    assert.doesNotMatch(JSON.stringify(landingCopy[locale]), /—/);
  }
});

test("landing route stays localized and sends users to existing product flows", async () => {
  const page = await readFile(pagePath, "utf8");
  const root = await readFile(rootPath, "utf8");
  assert.match(root, /redirect\("\/fr"\)/);
  assert.match(page, /href=\{`\/\$\{locale\}\/register`\}/);
  assert.match(page, /href=\{`\/\$\{locale\}\/salons`\}/);
  assert.match(page, /href=\{`\/\$\{locale\}\/login`\}/);
  assert.match(page, /canonical: `\/\$\{locale\}`/);
  assert.match(page, /languages: \{ fr: "\/fr", en: "\/en", es: "\/es" \}/);
  assert.match(page, /motion-safe:animate-/);
  assert.match(page, /<header className="sticky top-0 z-50/);
  assert.match(page, /<MotionPreview kind="hero"/);
  assert.match(page, /<MotionPreview kind="booking"/);
  assert.match(page, /BrandLogo/);
  assert.match(page, /pexels-nail-colors\.webp/);
  assert.doesNotMatch(page, /Sparkles/);
  assert.doesNotMatch(page, /—/);
});

test("pricing contact subjects follow the selected landing language", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /subject=\$\{encodeURIComponent\(copy\.pricing\.emailSubject\)\}/);
  assert.equal(landingCopy.fr.pricing.emailSubject, "Tarifs GlowFlow");
  assert.equal(landingCopy.en.pricing.emailSubject, "GlowFlow pricing");
  assert.equal(landingCopy.es.pricing.emailSubject, "Precios de GlowFlow");
});

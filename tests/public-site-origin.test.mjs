import assert from "node:assert/strict";
import test from "node:test";

import { publicSiteOrigin, publicSiteUrl } from "../lib/public-site-origin.ts";

test("production public URLs preserve the current host until an approved origin is configured", () => {
  assert.equal(publicSiteOrigin({ VERCEL_ENV: "production" }), "https://glowflow.mocktar.com");
  assert.equal(publicSiteUrl("/fr/salons", { VERCEL_ENV: "production" }), "https://glowflow.mocktar.com/fr/salons");
  assert.equal(publicSiteUrl("/es/salons/locations/US?page=2", { VERCEL_ENV: "production", GLOWFLOW_CANONICAL_ORIGIN: "https://glowflow.beauty" }), "https://glowflow.beauty/es/salons/locations/US?page=2");
  assert.equal(publicSiteOrigin({ VERCEL_ENV: "production", GLOWFLOW_CANONICAL_ORIGIN: "https://glowflow.beauty/" }), "https://glowflow.beauty");
  assert.equal(publicSiteOrigin({ VERCEL_ENV: "production", GLOWFLOW_APP_URL: "https://unreviewed.example" }), "https://glowflow.mocktar.com");
});

test("production rejects malformed and unapproved canonical origins", () => {
  for (const origin of ["", "not a URL", "http://glowflow.beauty", "https://evil.example", "https://glowflow.beauty.evil.example", "https://qa.glowflow.beauty", "https://GLOWFLOW.BEAUTY", "https://glowflow.beauty.", "https://glowflow.beauty:443", "https://glowflow.beauty:444", "https://glowflow.beauty/path", "https://glowflow.beauty?x=1", "https://glowflow.beauty#fragment", " https://glowflow.beauty", "https://user@glowflow.beauty", "https://glowflow.beauty//"]) {
    assert.throws(() => publicSiteOrigin({ VERCEL_ENV: "production", GLOWFLOW_CANONICAL_ORIGIN: origin }), /Invalid GlowFlow production origin/, origin);
  }
  for (const path of ["https://evil.example", "//evil.example", "relative/path"]) {
    assert.throws(() => publicSiteUrl(path, { VERCEL_ENV: "production" }), /Invalid public site path/, path);
  }
});

test("preview and local metadata retain their current origins", () => {
  assert.equal(publicSiteOrigin({ VERCEL_ENV: "preview", VERCEL_URL: "preview.vercel.app", GLOWFLOW_CANONICAL_ORIGIN: "https://glowflow.beauty" }), "https://preview.vercel.app");
  assert.equal(publicSiteOrigin({}), "http://localhost:3000");
  for (const host of ["evil.example", "preview.vercel.app/path", "preview.vercel.app:444", "https://preview.vercel.app"]) {
    assert.throws(() => publicSiteOrigin({ VERCEL_ENV: "preview", VERCEL_URL: host }), /Invalid GlowFlow preview origin/);
  }
});

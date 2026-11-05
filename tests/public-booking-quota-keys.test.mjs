import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../lib/public-booking-quota-keys.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
} }).outputText;
const loaded = { exports: {} };
new Function("require", "exports", js)(require, loaded.exports);
const { publicBookingQuotaKeys } = loaded.exports;
const encodedKey = Buffer.alloc(32, 29).toString("base64url");
const env = { VERCEL_ENV: "preview", GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY: encodedKey };
const request = (ip, extra = {}) => new Request("https://glowflow.mocktar.com/api/public-booking/v2", {
  headers: { ...(ip === null ? {} : { "x-forwarded-for": ip }), ...extra },
});

test("quota digests are stable, scoped, and do not expose raw IP or cookie", () => {
  const first = publicBookingQuotaKeys(request("192.0.2.1"), "signed-browser-cookie", env);
  assert.match(first.ipDigest, /^[0-9a-f]{64}$/);
  assert.match(first.browserDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(first, publicBookingQuotaKeys(request("192.0.2.1"), "signed-browser-cookie", env));
  assert.equal(first.ipDigest, publicBookingQuotaKeys(request("192.0.2.1"), null, env).ipDigest);
  assert.equal(publicBookingQuotaKeys(request("192.0.2.1"), null, env).browserDigest, null);
  assert.notEqual(first.ipDigest, first.browserDigest);
  assert.notEqual(first.ipDigest, publicBookingQuotaKeys(request("192.0.2.2"), "signed-browser-cookie", env).ipDigest);
  assert.notEqual(first.browserDigest, publicBookingQuotaKeys(request("192.0.2.1"), "another-cookie", env).browserDigest);
  assert.doesNotMatch(JSON.stringify(first), /192\.0\.2\.1|signed-browser-cookie/);
});

test("untrusted runtime, missing key, and invalid key fail closed", () => {
  for (const runtime of [undefined, "development", "test"]) {
    assert.equal(publicBookingQuotaKeys(request("192.0.2.1"), null, { ...env, VERCEL_ENV: runtime }), null);
  }
  for (const key of [undefined, "short", "A".repeat(43), `${encodedKey}=`]) {
    assert.equal(publicBookingQuotaKeys(request("192.0.2.1"), null,
      { ...env, GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY: key }), null);
  }
  assert.equal(publicBookingQuotaKeys(request("192.0.2.1"), "", env), null);
  assert.equal(publicBookingQuotaKeys(request("192.0.2.1"), "x".repeat(257), env), null);
});

test("missing, malformed, chained, and conflicting forwarded IPs fail closed", () => {
  for (const ip of [null, "", "unknown", "192.0.2.1, 10.0.0.1", "192.0.2.1:80", "[2001:db8::1]", "fe80::1%eth0"]) {
    assert.equal(publicBookingQuotaKeys(request(ip), null, env), null, String(ip));
  }
  const rawSpace = { headers: { get: (name) => name === "x-forwarded-for" ? " 192.0.2.1" : null } };
  assert.equal(publicBookingQuotaKeys(rawSpace, null, env), null);
  assert.equal(publicBookingQuotaKeys(request("192.0.2.1", { "x-vercel-forwarded-for": "192.0.2.2" }), null, env), null);
  assert.ok(publicBookingQuotaKeys(request("192.0.2.1", { "x-vercel-forwarded-for": "192.0.2.1" }), null, env));
});

test("IPv6 variants and IPv4-mapped addresses share quota buckets", () => {
  assert.equal(publicBookingQuotaKeys(request("2001:0DB8:0:0:0:0:0:1"), null, env).ipDigest,
    publicBookingQuotaKeys(request("2001:db8::1"), null, env).ipDigest);
  assert.equal(publicBookingQuotaKeys(request("::ffff:192.0.2.1"), null, env).ipDigest,
    publicBookingQuotaKeys(request("192.0.2.1"), null, env).ipDigest);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/stripe-sandbox-config.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { sandboxConfiguration, creationWindowOpen } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const env = { GLOWFLOW_STRIPE_SANDBOX_ONBOARDING: "true", STRIPE_RESTRICTED_KEY: "rk_test_fixture", STRIPE_SANDBOX_ACCOUNT_ID: "acct_1UCiSZDNDjGEQe6f", GLOWFLOW_APP_URL: "https://glowflow.mocktar.com" };

test("sandbox onboarding requires explicit activation and the dedicated platform", () => {
  assert.equal(sandboxConfiguration({}), null);
  assert.equal(sandboxConfiguration({ ...env, GLOWFLOW_STRIPE_SANDBOX_ONBOARDING: "false" }), null);
  assert.equal(sandboxConfiguration({ ...env, STRIPE_SANDBOX_ACCOUNT_ID: "acct_other" }), null);
  assert.equal(sandboxConfiguration(env).origin, "https://glowflow.mocktar.com");
});
test("live, unrestricted and missing keys cannot activate sandbox onboarding", () => {
  for (const key of ["rk_live_fixture", "sk_live_fixture", "sk_test_fixture", "", undefined]) {
    assert.equal(sandboxConfiguration({ ...env, STRIPE_RESTRICTED_KEY: key }), null);
  }
});
test("callback origin rejects credentials, paths and insecure URLs", () => {
  for (const origin of ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?next=evil", "https://example.com/#fragment", "invalid"]) {
    assert.equal(sandboxConfiguration({ ...env, GLOWFLOW_APP_URL: origin }), null);
  }
});
test("creation retries stop before Stripe idempotency keys expire", () => {
  const now = Date.parse("2026-09-06T12:00:00Z");
  assert.equal(creationWindowOpen(new Date(now - 22 * 3600000).toISOString(), now), true);
  assert.equal(creationWindowOpen(new Date(now - 23 * 3600000).toISOString(), now), false);
  assert.equal(creationWindowOpen(new Date(now + 1000).toISOString(), now), false);
  assert.equal(creationWindowOpen("invalid", now), false);
});

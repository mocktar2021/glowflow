import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { audience, verifyScheduleToken } from "../lib/glow56-cleanup-oidc.mjs";

const issuer = "https://token.actions.githubusercontent.com";
const claims = {
  sub: "repo:mocktar2021/glowflow:ref:refs/heads/master",
  repository: "mocktar2021/glowflow",
  repository_id: "1357531545",
  repository_owner_id: "94203523",
  repository_visibility: "public",
  ref: "refs/heads/master",
  ref_type: "branch",
  workflow_ref: "mocktar2021/glowflow/.github/workflows/glow56-qa-cleanup.yml@refs/heads/master",
  event_name: "schedule",
};

test("only a signed, fresh scheduled master token from the exact GlowFlow job passes", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const key = { ...await exportJWK(publicKey), kid: "fixture-key", alg: "RS256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [key] });
  const sign = (payload = claims, iss = issuer, aud = audience, expired = false) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
      .setIssuer(iss).setAudience(aud).setIssuedAt(expired ? now - 900 : now)
      .setExpirationTime(expired ? now - 5 : now + 300).sign(privateKey);
  };
  const valid = await sign();
  assert.equal(await verifyScheduleToken(valid, keys), true);
  const [header, payload, signature] = valid.split(".");
  const alteredSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  assert.equal(await verifyScheduleToken(`${header}.${payload}.${alteredSignature}`, keys), false);
  assert.equal(await verifyScheduleToken(await sign(claims, "https://wrong.example"), keys), false);
  assert.equal(await verifyScheduleToken(await sign(claims, issuer, "wrong-audience"), keys), false);
  assert.equal(await verifyScheduleToken(await sign(claims, issuer, audience, true), keys), false);
  for (const [field, value] of Object.entries({
    sub: "repo:mocktar2021/glowflow:environment:glowflow-qa-booking-cleanup",
    repository: "mocktar2021/mowflow", repository_id: "1", repository_owner_id: "1",
    repository_visibility: "private", ref: "refs/heads/feature", ref_type: "tag",
    workflow_ref: "mocktar2021/glowflow/.github/workflows/other.yml@refs/heads/master",
    environment: "Production", event_name: "workflow_dispatch",
  })) {
    assert.equal(await verifyScheduleToken(await sign({ ...claims, [field]: value }), keys), false,
      `${field} must be exact`);
  }
  assert.equal(await verifyScheduleToken("not-a-token", keys), false);
});

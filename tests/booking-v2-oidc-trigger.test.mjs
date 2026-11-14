import assert from "node:assert/strict";
import test from "node:test";
import { trigger } from "../ops/booking-v2-oidc-trigger.mjs";

const env = {
  GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "mocktar2021/glowflow",
  GITHUB_REF: "refs/heads/master", GITHUB_EVENT_NAME: "schedule",
  GITHUB_WORKFLOW_REF: "mocktar2021/glowflow/.github/workflows/glow56-qa-cleanup.yml@refs/heads/master",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/oidc/token?foo=bar",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "r".repeat(32),
};

test("scheduled trigger sends only a short-lived identity to the fixed QA route", async () => {
  const token = "signed".repeat(30);
  const seen = [];
  const logs = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url: String(url), options });
    if (seen.length === 1) return new Response(JSON.stringify({ value: token }), { status: 200 });
    return new Response(null, { status: 204 });
  };
  assert.equal(await trigger(env, fetchImpl, value => logs.push(value)), 0);
  assert.equal(new URL(seen[0].url).searchParams.get("audience"), "glowflow-qa-cleanup-v1");
  assert.equal(seen[0].options.redirect, "error");
  assert.equal(seen[0].options.headers.authorization, `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`);
  assert.equal(seen[1].url, "https://glowflow.mocktar.com/api/internal/glow56-cleanup");
  assert.equal(seen[1].options.method, "POST");
  assert.equal(seen[1].options.redirect, "error");
  assert.equal(seen[1].options.headers.authorization, `Bearer ${token}`);
  assert.ok(!JSON.stringify(logs).includes(token));
  assert.ok(!JSON.stringify(logs).includes(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN));
});

test("wrong scope, refused identity, and unsuccessful cleanup fail closed", async () => {
  const logs = [];
  let calls = 0;
  assert.equal(await trigger({ ...env, GITHUB_REF: "refs/heads/feature" },
    async () => { calls += 1; throw new Error("network"); }, value => logs.push(value)), 1);
  assert.equal(calls, 0);
  assert.equal(await trigger(env,
    async () => new Response(null, { status: 302 }), value => logs.push(value)), 1);
  assert.equal(await trigger(env, async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ value: "signed".repeat(30) }), { status: 200 })
      : new Response(null, { status: 503 });
  }, value => logs.push(value)), 1);
  assert.ok(!JSON.stringify(logs).includes(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN));
});

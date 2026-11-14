import assert from "node:assert/strict";
import test from "node:test";
import { handleGlow56Cleanup } from "../lib/glow56-cleanup-handler.mjs";

const ping = "https://hc-ping.com/d1665499-e827-441f-bf13-8f15e8f4c0b9";
const env = {
  GLOWFLOW_QA_OIDC_CLEANUP_ACTIVE: "enable-glow56-qa-oidc-cleanup-20261110",
  VERCEL_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://rfwhqutkiztxkagbhevp.supabase.co",
  SUPABASE_SECRET_KEY: "s".repeat(40),
  GLOWFLOW_QA_HEALTHCHECKS_PING_URL: ping,
};
const request = (options = {}) => new Request(
  options.url || "https://glowflow.mocktar.com/api/internal/glow56-cleanup",
  { method: "POST", headers: {
    host: options.host || "glowflow.mocktar.com",
    authorization: options.authorization === undefined ? "Bearer signed.fixture.token" : options.authorization,
  } },
);

test("inactive, wrong-target, and unauthorized calls cannot touch cleanup or Healthchecks", async () => {
  let calls = 0;
  const dependencies = {
    verify: async () => { calls += 1; return true; },
    cleanup: async () => { calls += 10; return 0; },
    healthcheck: async () => { calls += 100; return true; },
  };
  for (const [req, candidate] of [
    [request(), { ...env, GLOWFLOW_QA_OIDC_CLEANUP_ACTIVE: undefined }],
    [request(), { ...env, GLOWFLOW_QA_VERCEL_CLEANUP_ACTIVE: "enable-glow56-qa-vercel-cleanup-20261114" }],
    [request(), { ...env, VERCEL_ENV: "preview" }],
    [request(), { ...env, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" }],
    [request({ host: "evil.example" }), env],
    [request({ url: "https://preview.vercel.app/api/internal/glow56-cleanup" }), env],
    [request({ authorization: "basic secret" }), env],
  ]) assert.equal((await handleGlow56Cleanup(req, candidate, dependencies)).status, 404);
  assert.equal(calls, 0);
  assert.equal((await handleGlow56Cleanup(request(), env,
    { ...dependencies, verify: async () => false })).status, 404);
  assert.equal(calls, 0);
});

test("missing credentials or malformed Healthchecks URL fails before any sweep", async () => {
  let calls = 0;
  const dependencies = { verify: async () => true,
    cleanup: async () => { calls += 1; return 0; } };
  assert.equal((await handleGlow56Cleanup(request(),
    { ...env, SUPABASE_SECRET_KEY: undefined }, dependencies)).status, 503);
  assert.equal((await handleGlow56Cleanup(request(),
    { ...env, GLOWFLOW_QA_HEALTHCHECKS_PING_URL: `${ping}/fail` }, dependencies)).status, 503);
  assert.equal(calls, 0);
});

test("only both complete sweeps and an accepted external ping return success", async () => {
  const modes = [];
  const dependencies = { verify: async () => true,
    cleanup: async config => {
      assert.equal(config.GLOWFLOW_CLEANUP_PROJECT_REF, "rfwhqutkiztxkagbhevp");
      assert.equal(config.GLOWFLOW_CLEANUP_MAX_WALL_MS, "45000");
      assert.equal(config.GLOWFLOW_CLEANUP_SERVICE_ROLE_KEY, env.SUPABASE_SECRET_KEY);
      return 0;
    },
    healthcheck: async (mode, config) => {
      modes.push(mode);
      assert.equal(config.GLOWFLOW_QA_HEALTHCHECKS_PING_URL, ping);
      return true;
    },
  };
  const result = await handleGlow56Cleanup(request(), env, dependencies);
  assert.equal(result.status, 204);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(modes, ["ping"]);
  assert.equal((await handleGlow56Cleanup(request(), env,
    { ...dependencies, healthcheck: async () => false })).status, 503);
});

test("sweep failure signals failure and never sends a healthy ping", async () => {
  const modes = [];
  const dependencies = { verify: async () => true, cleanup: async () => 1,
    healthcheck: async mode => { modes.push(mode); return true; } };
  assert.equal((await handleGlow56Cleanup(request(), env, dependencies)).status, 503);
  assert.deepEqual(modes, ["fail"]);
});

test("real bounded cleanup adapter pings only after both RPCs complete", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const href = String(url);
    calls.push(href);
    assert.equal(options.redirect, "error");
    if (href.endsWith("/sweep_public_booking_intents")) return Response.json({
      complete: true, busy: false, scrubbed: 0, purged: 0, sessions_purged: 0,
    });
    if (href.endsWith("/sweep_public_booking_quota_counters")) return Response.json({
      complete: true, busy: false, removed: 0,
    });
    if (href === ping) return new Response("OK", { status: 200 });
    assert.fail(`Unexpected request ${href}`);
  };
  const result = await handleGlow56Cleanup(request(), env,
    { verify: async () => true, fetchImpl, log: () => {} });
  assert.equal(result.status, 204);
  assert.deepEqual(calls.map(value => value.split("/").at(-1)), [
    "sweep_public_booking_intents", "sweep_public_booking_quota_counters",
    "d1665499-e827-441f-bf13-8f15e8f4c0b9",
  ]);
});

test("real bounded cleanup adapter sends only failure after a busy sweep", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const href = String(url);
    calls.push(href);
    assert.equal(options.redirect, "error");
    if (href.endsWith("/sweep_public_booking_intents")) return Response.json({
      complete: false, busy: true, scrubbed: 0, purged: 0, sessions_purged: 0,
    });
    if (href === `${ping}/fail`) return new Response("OK", { status: 200 });
    assert.fail(`Unexpected request ${href}`);
  };
  const result = await handleGlow56Cleanup(request(), env,
    { verify: async () => true, fetchImpl, log: () => {} });
  assert.equal(result.status, 503);
  assert.deepEqual(calls.map(value => value.split("/").at(-1)), [
    "sweep_public_booking_intents", "fail",
  ]);
});

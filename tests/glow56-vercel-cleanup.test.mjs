import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { handleVercelGlow56Cleanup } from "../lib/glow56-vercel-cleanup.mjs";

const path = "/api/internal/glow56-vercel-cleanup";
const secret = "fixture-" + "x".repeat(40);
const env = {
  GLOWFLOW_QA_VERCEL_CLEANUP_ACTIVE: "enable-glow56-qa-vercel-cleanup-20261114",
  VERCEL_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://rfwhqutkiztxkagbhevp.supabase.co",
  CRON_SECRET: secret,
  SUPABASE_SECRET_KEY: "s".repeat(40),
  GLOWFLOW_QA_HEALTHCHECKS_PING_URL: "https://hc-ping.com/d1665499-e827-441f-bf13-8f15e8f4c0b9",
};
const request = (options = {}) => new Request(
  options.url || `https://glowflow.mocktar.com${path}`,
  { method: options.method || "GET", headers: {
    host: options.host || "glowflow.mocktar.com",
    authorization: options.authorization === undefined ? `Bearer ${secret}` : options.authorization,
    "x-vercel-cron-schedule": options.schedule === undefined
      ? "17,47 * * * *" : options.schedule,
  } },
);

test("the dormant adapter rejects inactive, wrong-target and unauthenticated calls before cleanup", async () => {
  let calls = 0;
  const dependencies = {
    cleanup: async () => { calls += 1; return 0; },
    healthcheck: async () => { calls += 10; return true; },
  };
  for (const [req, candidate] of [
    [request(), { ...env, GLOWFLOW_QA_VERCEL_CLEANUP_ACTIVE: undefined }],
    [request(), { ...env, VERCEL_ENV: "preview" }],
    [request(), { ...env, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" }],
    [request(), { ...env, CRON_SECRET: undefined }],
    [request(), { ...env, CRON_SECRET: "short" }],
    [request({ host: "other.example" }), env],
    [request({ url: `https://preview.vercel.app${path}` }), env],
    [request({ url: `https://glowflow.mocktar.com${path}?preview=1` }), env],
    [request({ method: "POST" }), env],
    [request({ schedule: "* * * * *" }), env],
    [request({ authorization: "Bearer wrong" }), env],
    [request({ authorization: "" }), env],
  ]) {
    const result = await handleVercelGlow56Cleanup(req, candidate, dependencies);
    assert.equal(result.status, 404);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
});

test("authenticated execution reuses bounded sweep and reports health only after completion", async () => {
  const events = [];
  const dependencies = {
    cleanup: async config => {
      events.push("cleanup");
      assert.equal(config.GLOWFLOW_CLEANUP_PROJECT_REF, "rfwhqutkiztxkagbhevp");
      assert.equal(config.GLOWFLOW_CLEANUP_MAX_CALLS_PER_SWEEP, "25");
      return 0;
    },
    healthcheck: async mode => { events.push(mode); return true; },
  };
  assert.equal((await handleVercelGlow56Cleanup(request(), env, dependencies)).status, 204);
  assert.deepEqual(events, ["cleanup", "ping"]);
  events.length = 0;
  assert.equal((await handleVercelGlow56Cleanup(request(), env, {
    ...dependencies, cleanup: async () => { events.push("cleanup"); return 1; },
  })).status, 503);
  assert.deepEqual(events, ["cleanup", "fail"]);
});

test("the merged code has no Vercel job that could invoke the adapter", () => {
  for (const file of ["vercel.json", "vercel.ts"]) {
    if (!existsSync(new URL(`../${file}`, import.meta.url))) continue;
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      /glow56-vercel-cleanup/);
  }
});

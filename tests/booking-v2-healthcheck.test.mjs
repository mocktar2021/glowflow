import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { run, validatedPingUrl } from "../ops/booking-v2-healthcheck.mjs";

const ping = "https://hc-ping.com/d1665499-e827-441f-bf13-8f15e8f4c0b9";

test("QA check accepts only the canonical secret success endpoint", () => {
  assert.equal(validatedPingUrl(ping)?.href, ping);
  for (const value of [undefined, "", "http://hc-ping.com/d1665499-e827-441f-bf13-8f15e8f4c0b9",
    "https://hc-ping.com.evil.test/d1665499-e827-441f-bf13-8f15e8f4c0b9",
    "https://user@hc-ping.com/d1665499-e827-441f-bf13-8f15e8f4c0b9",
    `${ping}/fail`, `${ping}?token=secret`, `${ping}#secret`, `${ping}/`,
    "https://hc-ping.com/route-fixture", "https://hc-ping.com/d1665499-e827-441f-bf13-8f15e8f4c0b9:443",
  ]) assert.equal(validatedPingUrl(value), null);
});

test("preflight makes no network request and missing/invalid URL fails closed", async () => {
  const noFetch = () => { throw new Error("network must not be used"); };
  assert.equal(await run("preflight", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: ping }, noFetch), true);
  assert.equal(await run("preflight", {}, noFetch), false);
  assert.equal(await run("ping", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: "https://evil.test" }, noFetch), false);
  assert.equal(await run("unsupported", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: ping }, noFetch), false);
});

test("success ping is bounded, redirect-safe, and never sends a body", async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(url.href, ping);
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.body, undefined);
    assert.equal(options.signal.aborted, false);
    return new Response("OK", { status: 200 });
  };
  assert.equal(await run("ping", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: ping }, fetchImpl), true);
  assert.equal(calls, 1);
  assert.equal(await run("ping", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: ping }, async () => new Response(null, { status: 302 })), false);
  assert.equal(await run("ping", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: ping }, async () => new Response(null, { status: 500 })), false);
  assert.equal(await run("ping", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: ping }, async () => new Response("not found", { status: 200 })), false);
  assert.equal(await run("ping", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: ping }, async () => new Response("rate limited", { status: 200 })), false);
  assert.equal(await run("ping", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: ping }, async () => new Response("x".repeat(64), { status: 200 })), false);
  assert.equal(await run("ping", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: ping }, async () => { throw new Error(ping); }), false);
});

test("cleanup failure signals only the derived Healthchecks failure endpoint", async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(url.href, `${ping}/fail`);
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.body, undefined);
    return new Response("OK", { status: 200 });
  };
  assert.equal(await run("fail", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: ping }, fetchImpl), true);
  assert.equal(calls, 1);
  assert.equal(await run("fail", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: `${ping}/fail` }, fetchImpl), false);
  assert.equal(calls, 1);
  assert.equal(await run("fail", { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: ping }, async () => new Response(null, { status: 500 })), false);
});

test("CLI failure diagnostics do not print the bearer URL", () => {
  const child = spawnSync(process.execPath, ["ops/booking-v2-healthcheck.mjs", "ping"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8",
    env: { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: `${ping}/fail` }, timeout: 10_000,
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /healthcheck unavailable/);
  assert.ok(!`${child.stdout}${child.stderr}`.includes(ping));
});

test("dormant shared-backend schedule holds no database or ping secret", () => {
  const source = readFileSync(new URL("../.github/workflows/glow56-qa-cleanup.yml", import.meta.url), "utf8");
  assert.match(source, /cron: "17,47 \* \* \* \*"/);
  assert.doesNotMatch(source, /workflow_dispatch:|pull_request:|push:/);
  assert.match(source, /github\.repository == 'mocktar2021\/glowflow'/);
  assert.match(source, /github\.ref == 'refs\/heads\/master'/);
  assert.match(source, /vars\.GLOWFLOW_QA_CLEANUP_SCHEDULE_ACK == 'enable-glow56-qa-oidc-cleanup-20261110'/);
  assert.match(source, /permissions:\n  contents: read/);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /timeout-minutes: 10/);
  assert.doesNotMatch(source, /^    environment:/m);
  assert.match(source, /id-token: write/);
  assert.match(source, /checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.match(source, /setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /node ops\/booking-v2-oidc-trigger\.mjs/);
  assert.doesNotMatch(source, /secrets\.|GLOWFLOW_CLEANUP_SERVICE_ROLE_KEY|booking-v2-cleanup\.mjs/);
  assert.match(source, /also backs glowflow\.mocktar\.com/);
  assert.doesNotMatch(source, /continue-on-error:|if: \$\{\{ always\(\) \}\}/);
});

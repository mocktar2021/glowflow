import assert from "node:assert/strict";
import test from "node:test";

import { CleanupFailure, configuration, drainSweeps, main } from "../ops/booking-v2-cleanup.mjs";

const fixtureConfig = { maxCalls: 3, maxWallMs: 5_000, intentBatch: 2, quotaBatch: 3 };
const fixtureEnv = {
  GLOWFLOW_CLEANUP_EXECUTE: "run-glowflow-qa-cleanup-only",
  GLOWFLOW_CLEANUP_PROJECT_REF: "rfwhqutkiztxkagbhevp",
  GLOWFLOW_CLEANUP_SUPABASE_URL: "https://rfwhqutkiztxkagbhevp.supabase.co",
  GLOWFLOW_CLEANUP_SERVICE_ROLE_KEY: "fixture-only-opaque-key-with-32-characters",
  GLOWFLOW_CLEANUP_MAX_CALLS_PER_SWEEP: "3",
  GLOWFLOW_CLEANUP_MAX_WALL_MS: "5000",
  GLOWFLOW_CLEANUP_INTENT_BATCH_LIMIT: "2",
  GLOWFLOW_CLEANUP_QUOTA_BATCH_LIMIT: "3",
};

const intent = (complete, scrubbed = 0, purged = 0, sessions_purged = 0) =>
  ({ complete, busy: false, scrubbed, purged, sessions_purged });
const quota = (complete, removed = 0) => ({ complete, removed });

test("operator scope requires exact GlowFlow QA ref, origin, acknowledgement and bounded choices", () => {
  assert.equal(configuration(fixtureEnv).origin, "https://rfwhqutkiztxkagbhevp.supabase.co");
  for (const changed of [
    { GLOWFLOW_CLEANUP_EXECUTE: "" },
    { GLOWFLOW_CLEANUP_PROJECT_REF: "mowflow" },
    { GLOWFLOW_CLEANUP_SUPABASE_URL: "https://mowflow.supabase.co" },
    { GLOWFLOW_CLEANUP_SUPABASE_URL: fixtureEnv.GLOWFLOW_CLEANUP_SUPABASE_URL + "/rest/v1" },
    { GLOWFLOW_CLEANUP_SUPABASE_URL: fixtureEnv.GLOWFLOW_CLEANUP_SUPABASE_URL + "?redirect=1" },
    { GLOWFLOW_CLEANUP_MAX_CALLS_PER_SWEEP: "26" },
    { GLOWFLOW_CLEANUP_MAX_WALL_MS: "60001" },
    { GLOWFLOW_CLEANUP_INTENT_BATCH_LIMIT: "101" },
    { GLOWFLOW_CLEANUP_QUOTA_BATCH_LIMIT: "1001" },
  ]) {
    assert.throws(() => configuration({ ...fixtureEnv, ...changed }), CleanupFailure);
  }
});

test("bounded runner drains intent PII before quota counters and reports aggregate counts", async () => {
  const calls = [];
  const replies = [intent(false, 1), intent(true, 1), quota(true, 2)];
  const summary = await drainSweeps(fixtureConfig, async (stage, limit, timeoutMs) => {
    calls.push({ stage, limit, timeoutMs });
    return replies.shift();
  }, () => 0);
  assert.deepEqual(calls.map(({ stage, limit }) => [stage, limit]),
    [["intent", 2], ["intent", 2], ["quota", 3]]);
  assert.deepEqual(summary, {
    intent: { calls: 2, scrubbed: 2, purged: 0, sessionsPurged: 0 },
    quota: { calls: 1, removed: 2 },
  });
  assert.ok(calls.every(({ timeoutMs }) => timeoutMs <= 10_000));
});

test("busy, undrained, invalid, transport and deadline outcomes fail before quota success", async () => {
  const cases = [
    { name: "busy", first: { complete: false, busy: true }, code: "busy" },
    { name: "invalid", first: intent(true, 3), code: "response" },
  ];
  for (const { first, code } of cases) {
    const seen = [];
    await assert.rejects(drainSweeps(fixtureConfig, async stage => {
      seen.push(stage);
      return first;
    }, () => 0), reason => reason instanceof CleanupFailure
      && reason.stage === "intent" && reason.code === code);
    assert.deepEqual(seen, ["intent"]);
  }
  const seen = [];
  await assert.rejects(drainSweeps({ ...fixtureConfig, maxCalls: 2 }, async stage => {
    seen.push(stage);
    return intent(false, 1);
  }, () => 0), reason => reason.code === "incomplete" && reason.stage === "intent");
  assert.deepEqual(seen, ["intent", "intent"]);
  await assert.rejects(drainSweeps(fixtureConfig, async () => { throw new Error("secret contact"); }, () => 0),
    reason => reason.code === "transport" && !reason.message.includes("secret contact"));
  let clock = 0;
  await assert.rejects(drainSweeps(fixtureConfig, async () => {
    clock = 5_000;
    return intent(true);
  }, () => clock), reason => reason.code === "deadline" && reason.stage === "intent");
});

test("quota busy or invalid result cannot be reported as a complete run", async () => {
  for (const response of [{ complete: false, busy: true }, { complete: true, removed: 4 }]) {
    await assert.rejects(drainSweeps(fixtureConfig, async stage =>
      stage === "intent" ? intent(true) : response, () => 0),
    reason => reason instanceof CleanupFailure && reason.stage === "quota");
  }
});

test("manual entrypoint invokes only the two fixed RPCs and never logs credentials or errors", async () => {
  const calls = [];
  const logs = [];
  const code = await main(fixtureEnv, async (url, options) => {
    calls.push({ url, body: options.body, method: options.method, key: options.headers.apikey });
    return { ok: true, async json() {
      return url.endsWith("sweep_public_booking_intents") ? intent(true, 1) : quota(true, 2);
    } };
  }, line => logs.push(line));
  assert.equal(code, 0);
  assert.deepEqual(calls.map(({ url }) => url), [
    "https://rfwhqutkiztxkagbhevp.supabase.co/rest/v1/rpc/sweep_public_booking_intents",
    "https://rfwhqutkiztxkagbhevp.supabase.co/rest/v1/rpc/sweep_public_booking_quota_counters",
  ]);
  assert.deepEqual(calls.map(({ body }) => JSON.parse(body).batch_limit), [2, 3]);
  assert.ok(calls.every(({ method, key }) => method === "POST" && key === fixtureEnv.GLOWFLOW_CLEANUP_SERVICE_ROLE_KEY));
  assert.equal(JSON.parse(logs[0]).status, "complete");
  assert.doesNotMatch(logs.join(""), /fixture-only-opaque-key|email|phone|browser_token/);

  const failedLogs = [];
  const failed = await main(fixtureEnv, async () => { throw new Error("secret contact and key"); },
    line => failedLogs.push(line));
  assert.equal(failed, 1);
  assert.deepEqual(JSON.parse(failedLogs[0]), {
    event: "glowflow_booking_cleanup", scope: "glowflow_qa",
    status: "failed", stage: "intent", code: "transport",
  });
  assert.doesNotMatch(failedLogs.join(""), /secret contact|fixture-only-opaque-key/);

  let contacted = false;
  const wrongScope = await main({ ...fixtureEnv, GLOWFLOW_CLEANUP_PROJECT_REF: "mowflow" },
    async () => { contacted = true; }, () => {});
  assert.equal(wrongScope, 1);
  assert.equal(contacted, false);
});

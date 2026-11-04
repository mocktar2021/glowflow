import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/staff-invitation-worker.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function load(defaultRun) {
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)(name => {
    if (name === "server-only") return {};
    if (name === "@/lib/staff-invitation-runner") return { runNextStaffInvitationDelivery: defaultRun };
    assert.fail(`unexpected import: ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports.runStaffInvitationWorkerOnce;
}

test("one invocation performs one run and emits no alert for disabled, idle, or sent", async () => {
  for (const status of ["disabled", "idle", "sent"]) {
    let runs = 0;
    const alerts = [];
    const run = load(async () => { runs += 1; return status; });
    assert.equal(await run(async alert => { alerts.push(alert); }), status);
    assert.equal(runs, 1);
    assert.deepEqual(alerts, []);
  }
});

test("definite failure, unknown send, and unavailable infrastructure require distinct operator action", async () => {
  for (const [status, expected] of [
    ["failed", { code: "delivery_failed", action: "review_before_reissue" }],
    ["uncertain", { code: "delivery_uncertain", action: "reconcile_provider" }],
    ["unavailable", { code: "delivery_unavailable", action: "inspect_worker" }],
  ]) {
    const alerts = [];
    const run = load(async () => status);
    assert.equal(await run(async alert => { alerts.push(alert); }), status);
    assert.deepEqual(alerts, [expected]);
    assert.ok(!JSON.stringify(alerts).includes("@"));
  }
});

test("runner exception alerts without exposing its private message", async () => {
  const secret = "recipient@example.invalid private-token";
  const alerts = [];
  const run = load(async () => { throw new Error(secret); });
  assert.equal(await run(async alert => { alerts.push(alert); }), "unavailable");
  assert.deepEqual(alerts, [{ code: "delivery_unavailable", action: "inspect_worker" }]);
  assert.ok(!JSON.stringify(alerts).includes(secret));
});

test("unexpected runner status fails closed and alerts", async () => {
  const alerts = [];
  const run = load(async () => "unexpected-status");
  assert.equal(await run(async alert => { alerts.push(alert); }), "unavailable");
  assert.deepEqual(alerts, [{ code: "delivery_unavailable", action: "inspect_worker" }]);
});

test("failed alert delivery rejects with a constant message and never reruns the sender", async () => {
  let runs = 0;
  const run = load(async () => { runs += 1; return "uncertain"; });
  await assert.rejects(run(async () => { throw new Error("recipient@example.invalid private-token"); }),
    error => error.message === "Staff invitation operator alert unavailable"
      && !String(error).includes("recipient@example.invalid"));
  assert.equal(runs, 1);
});

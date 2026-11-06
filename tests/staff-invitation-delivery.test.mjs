import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/staff-invitation-delivery.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const requestKey = "70000000-0000-4000-8000-000000000001";
const deliveryId = "80000000-0000-4000-8000-000000000001";
const outboxKey = "local-only-fixture-passphrase-32-bytes";

function load({ enabled = false, verified = true, rpcError = null, rpcData = deliveryId } = {}) {
  const calls = [];
  const dependencies = {
    "server-only": {},
    "@/lib/supabase/server": { async createClient() {
      calls.push("client");
      return { auth: { async getUser() {
        calls.push("getUser");
        return { data: { user: { id: "owner-fixture", email_confirmed_at: verified ? "2026-11-03T00:00:00Z" : null } }, error: null };
      } } };
    } },
    "@/lib/supabase/admin": { createAdminClient() {
      calls.push("admin");
      return { async rpc(name, args) {
        calls.push(["rpc", name, args]);
        return { data: rpcData, error: rpcError };
      } };
    } },
  };
  const fixtureModule = { exports: {} };
  new Function("require", "module", "exports", "process", "Buffer", js)(
    name => {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected import: ${name}`);
      return dependencies[name];
    }, fixtureModule, fixtureModule.exports, {
      env: {
        GLOWFLOW_STAFF_INVITE_ISSUANCE_ENABLED: enabled ? "true" : "false",
        GLOWFLOW_INVITE_OUTBOX_KEY: outboxKey,
      },
    }, Buffer,
  );
  return { queue: fixtureModule.exports.queueStaffInvitationDelivery, calls };
}

test("issuance stays inert with the default-off flag or malformed request", async () => {
  const disabled = load();
  assert.deepEqual(await disabled.queue("staff@example.invalid", requestKey), { status: "unavailable" });
  assert.deepEqual(disabled.calls, []);
  const malformed = load({ enabled: true });
  assert.deepEqual(await malformed.queue("staff@example.invalid", "not-a-uuid"), { status: "unavailable" });
  assert.deepEqual(malformed.calls, []);
});

test("unverified sessions never reach the privileged client", async () => {
  const fixture = load({ enabled: true, verified: false });
  assert.deepEqual(await fixture.queue("staff@example.invalid", requestKey), { status: "unavailable" });
  assert.deepEqual(fixture.calls, ["client", "getUser"]);
});

test("verified owner identity is passed only to the service-only queue RPC", async () => {
  const fixture = load({ enabled: true });
  assert.deepEqual(await fixture.queue("Staff@Example.Invalid", requestKey), { status: "queued", deliveryId });
  assert.deepEqual(fixture.calls, [
    "client", "getUser", "admin",
    ["rpc", "enqueue_staff_invitation_delivery", {
      requesting_owner_id: "owner-fixture",
      target_email: "Staff@Example.Invalid",
      delivery_request_key: requestKey,
      encryption_passphrase: outboxKey,
    }],
  ]);
});

test("database failures return one generic result without leaking details", async () => {
  const fixture = load({ enabled: true, rpcError: { message: "private database detail" } });
  assert.deepEqual(await fixture.queue("staff@example.invalid", requestKey), { status: "unavailable" });
  assert.ok(!JSON.stringify(await fixture.queue("staff@example.invalid", requestKey)).includes("private database detail"));
});

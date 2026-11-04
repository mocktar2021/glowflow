import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/staff-invitation-sender.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const token = "B".repeat(43);
const id = "80000000-0000-4000-8000-000000000001";
const claim = {
  delivery_id: id,
  recipient_email: "staff@example.invalid",
  raw_token: token,
  expires_at: "2030-01-01T00:00:00Z",
  idempotency_key: `glowflow-staff-invite-${id}`,
  attempt_number: 1,
};

function fixture({ enabled = true, claims = [claim], claimError = null, settleData = true, settleError = null } = {}) {
  const calls = [];
  const dependencies = {
    "server-only": {},
    "@/lib/supabase/admin": { createAdminClient() {
      calls.push("admin");
      return { async rpc(name, args) {
        calls.push([name, args]);
        return name === "claim_staff_invitation_delivery"
          ? { data: claims, error: claimError }
          : { data: settleData, error: settleError };
      } };
    } },
    "@/lib/staff-invitation-email": { renderStaffInvitationEmail(rawToken) {
      calls.push(["render", rawToken]);
      return { subject: "invite", html: "<p>invite</p>", text: "invite" };
    } },
    "@/lib/staff-invitations": {
      staffInvitationsEnabled: () => enabled,
      validStaffInvitationToken: value => /^[A-Za-z0-9_-]{43}$/.test(value),
    },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", "Buffer", js)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected import: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, { env: {
    GLOWFLOW_STAFF_INVITE_DELIVERY_ENABLED: enabled ? "true" : "false",
    GLOWFLOW_INVITE_OUTBOX_KEY: "local-only-fixture-passphrase-32-bytes",
  } }, Buffer);
  return { process: loaded.exports.processNextStaffInvitationDelivery, calls };
}

test("default-off sender never claims or calls transport", async () => {
  const f = fixture({ enabled: false });
  assert.equal(await f.process(() => { throw new Error("must not send"); }), "disabled");
  assert.deepEqual(f.calls, []);
});

test("empty queue is idle and malformed claims never reach transport", async () => {
  const empty = fixture({ claims: [] });
  assert.equal(await empty.process(() => { throw new Error("must not send"); }), "idle");
  const bad = fixture({ claims: [{ ...claim, idempotency_key: "forged" }] });
  assert.equal(await bad.process(() => { throw new Error("must not send"); }), "unavailable");
  assert.ok(!bad.calls.some(call => Array.isArray(call) && call[0] === "render"));
});

test("one confirmed acknowledgement settles sent with the stable provider key", async () => {
  const f = fixture();
  const result = await f.process(async message => {
    assert.equal(message.to, "staff@example.invalid");
    assert.equal(message.idempotencyKey, claim.idempotency_key);
    assert.equal(message.signal.aborted, false);
    return { kind: "accepted", messageId: "provider-1" };
  });
  assert.equal(result, "sent");
  assert.deepEqual(f.calls.at(-1), ["settle_staff_invitation_delivery", {
    target_delivery_id: id, delivery_outcome: "sent", provider_reference: "provider-1",
  }]);
});

test("definite non-send fails closed; thrown or malformed acknowledgement is uncertain", async () => {
  for (const [transport, expected] of [
    [async () => ({ kind: "not_sent", retryable: true }), "failed"],
    [async () => { throw new Error(`private provider detail ${token}`); }, "uncertain"],
    [async () => ({ kind: "accepted", messageId: "bad\nheader" }), "uncertain"],
  ]) {
    const f = fixture();
    assert.equal(await f.process(transport), expected);
    assert.equal(f.calls.at(-1)[1].delivery_outcome, expected);
    assert.ok(!JSON.stringify(f.calls.at(-1)).includes(token));
  }
});

test("a reclaimed lease is never sent a second time", async () => {
  const f = fixture({ claims: [{ ...claim, attempt_number: 2 }] });
  assert.equal(await f.process(() => { throw new Error("must not send again"); }), "uncertain");
  assert.equal(f.calls.at(-1)[1].delivery_outcome, "uncertain");
  assert.ok(!f.calls.some(call => Array.isArray(call) && call[0] === "render"));
});

test("an almost expired token is never sent", async () => {
  const f = fixture({ claims: [{ ...claim, expires_at: new Date(Date.now() + 60_000).toISOString() }] });
  assert.equal(await f.process(() => { throw new Error("must not send near expiry"); }), "failed");
  assert.ok(!f.calls.some(call => Array.isArray(call) && call[0] === "render"));
});

test("settlement failures do not claim a successful delivery", async () => {
  const f = fixture({ settleError: { message: "private database detail" } });
  assert.equal(await f.process(async () => ({ kind: "accepted", messageId: "provider-1" })), "unavailable");
});

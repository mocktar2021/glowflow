import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

import { publicSiteOrigin } from "../lib/public-site-origin.ts";

const root = new URL("../", import.meta.url);
const sources = Object.fromEntries(await Promise.all([
  "lib/staff-invitation-runner.ts",
  "lib/staff-invitation-resend.ts",
  "lib/staff-invitation-sender.ts",
  "lib/staff-invitation-email.ts",
  "lib/staff-invitations.ts",
].map(async file => [file, ts.transpileModule(await readFile(new URL(file, root), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText])));

const token = "B".repeat(43);
const deliveryId = "80000000-0000-4000-8000-000000000001";
const claim = {
  delivery_id: deliveryId,
  recipient_email: "staff@example.invalid",
  raw_token: token,
  expires_at: "2030-01-01T00:00:00Z",
  idempotency_key: `glowflow-staff-invite-${deliveryId}`,
  attempt_number: 1,
};
const secret = `re_${"X".repeat(32)}`;

function load(file, dependencies, globals) {
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", "Buffer", "fetch", "console", sources[file])(
    name => {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected import: ${name}`);
      return dependencies[name];
    },
    loaded, loaded.exports, globals.process, Buffer, globals.fetch, globals.console,
  );
  return loaded.exports;
}

function fixture({
  flags = [true, true, true],
  sender = "invites@email.glowflow.mocktar.com",
  origin = "https://qa.glowflow.mocktar.com",
  claims = [claim],
  response = Response.json({ id: "provider-message-id" }),
  settleError = null,
  vercelEnv = "preview",
  canonicalOrigin,
} = {}) {
  const calls = [];
  const logs = [];
  const env = {
    GLOWFLOW_STAFF_INVITES_ENABLED: String(flags[0]),
    GLOWFLOW_STAFF_INVITE_ISSUANCE_ENABLED: String(flags[1]),
    GLOWFLOW_STAFF_INVITE_DELIVERY_ENABLED: String(flags[2]),
    GLOWFLOW_INVITE_OUTBOX_KEY: "local-test-passphrase-at-least-32-bytes",
    GLOWFLOW_RESEND_API_KEY: secret,
    GLOWFLOW_RESEND_FROM_EMAIL: sender,
    GLOWFLOW_RESEND_REPLY_TO_EMAIL: "support@example.invalid",
    GLOWFLOW_APP_URL: origin,
    VERCEL_ENV: vercelEnv,
    GLOWFLOW_CANONICAL_ORIGIN: canonicalOrigin,
  };
  const globals = {
    process: { env },
    fetch: async (url, init) => {
      calls.push(["fetch", url, init]);
      if (response instanceof Error) throw response;
      return response;
    },
    console: Object.fromEntries(["log", "info", "warn", "error", "debug"].map(level => [
      level, (...args) => logs.push([level, ...args]),
    ])),
  };
  const flagsModule = load("lib/staff-invitations.ts", {}, globals);
  const emailModule = load("lib/staff-invitation-email.ts", {
    "server-only": {},
    "@/lib/public-site-origin": { publicSiteOrigin },
    "@/lib/staff-invitations": flagsModule,
  }, globals);
  const adapter = load("lib/staff-invitation-resend.ts", { "server-only": {} }, globals);
  const senderModule = load("lib/staff-invitation-sender.ts", {
    "server-only": {},
    "@/lib/supabase/admin": { createAdminClient() {
      calls.push(["admin"]);
      return { async rpc(name, args) {
        calls.push(["rpc", name, args]);
        return name === "claim_staff_invitation_delivery"
          ? { data: claims, error: null }
          : { data: !settleError, error: settleError };
      } };
    } },
    "@/lib/staff-invitation-email": emailModule,
    "@/lib/staff-invitations": flagsModule,
  }, globals);
  const runner = load("lib/staff-invitation-runner.ts", {
    "server-only": {},
    "@/lib/staff-invitation-resend": adapter,
    "@/lib/staff-invitation-sender": senderModule,
    "@/lib/staff-invitations": flagsModule,
  }, globals);
  return { run: runner.runNextStaffInvitationDelivery, flagsModule, calls, logs };
}

function outcomes(f) {
  return f.calls.filter(call => call[0] === "rpc" && call[1] === "settle_staff_invitation_delivery")
    .map(call => call[2].delivery_outcome);
}

test("any disabled invitation flag prevents a claim or send", async () => {
  for (const flags of [[false, false, false], [false, true, true], [true, false, true], [true, true, false]]) {
    const f = fixture({ flags });
    assert.equal(f.flagsModule.staffInvitationManagementEnabled(), false);
    assert.equal(await f.run(), "disabled");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.logs, []);
  }
});

test("the real invitation management predicate permits only all three enabled flags", async () => {
  const f = fixture({ flags: [true, true, true], claims: [] });
  assert.equal(f.flagsModule.staffInvitationManagementEnabled(), true);
  assert.equal(await f.run(), "idle");
});

test("bad Resend configuration never claims an outbox row", async () => {
  const f = fixture({ sender: "invites@email.mowflow.mocktar.com" });
  assert.equal(await f.run(), "unavailable");
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.logs, []);
});

test("an empty outbox is idle and never calls Resend", async () => {
  const f = fixture({ claims: [] });
  assert.equal(await f.run(), "idle");
  assert.ok(!f.calls.some(call => call[0] === "fetch"));
});

test("a preview origin pointing at the live host cannot claim or send", async () => {
  const f = fixture({ origin: "https://glowflow.mocktar.com" });
  assert.equal(await f.run(), "disabled");
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.logs, []);
});

test("production beauty cutover mismatch cannot claim or send an invitation", async () => {
  const f = fixture({ vercelEnv: "production", canonicalOrigin: "https://glowflow.beauty", origin: "https://glowflow.mocktar.com" });
  assert.equal(await f.run(), "disabled");
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.logs, []);
});

test("accepted, rejected, and uncertain responses settle once without logging private data", async () => {
  for (const [response, expected] of [
    [Response.json({ id: "provider-message-id" }), "sent"],
    [new Response("bad request", { status: 400 }), "failed"],
    [new Response("maybe sent", { status: 503 }), "uncertain"],
    [new Error("private provider failure"), "uncertain"],
  ]) {
    const f = fixture({ response });
    assert.equal(await f.run(), expected);
    assert.deepEqual(outcomes(f), [expected]);
    const sends = f.calls.filter(call => call[0] === "fetch");
    assert.equal(sends.length, 1);
    assert.equal(sends[0][2].headers["Idempotency-Key"], claim.idempotency_key);
    const body = JSON.parse(sends[0][2].body);
    assert.ok(body.html.includes(`https://qa.glowflow.mocktar.com/fr/join#token=${token}`));
    assert.ok(!body.html.includes('href="https://glowflow.mocktar.com'));
    assert.deepEqual(f.logs, []);
  }
});

test("settlement failure is unavailable, never claims success or logs secrets", async () => {
  const f = fixture({ settleError: { message: `private ${token} ${secret}` } });
  assert.equal(await f.run(), "unavailable");
  assert.deepEqual(outcomes(f), ["sent"]);
  assert.deepEqual(f.logs, []);
});

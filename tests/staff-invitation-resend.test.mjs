import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/staff-invitation-resend.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const key = `re_${"X".repeat(32)}`;
const defaults = {
  GLOWFLOW_RESEND_API_KEY: key,
  GLOWFLOW_RESEND_FROM_EMAIL: "invites@email.glowflow.mocktar.com",
  GLOWFLOW_RESEND_REPLY_TO_EMAIL: "support@glowflow.mocktar.com",
};
const message = {
  to: "staff@example.invalid",
  subject: "Invitation",
  html: '<a href="https://glowflow.mocktar.com/fr/join#invite=fragment-token">Join</a>',
  text: "Invitation link: https://glowflow.mocktar.com/fr/join#invite=fragment-token",
  idempotencyKey: "glowflow-staff-invite-80000000-0000-4000-8000-000000000001",
  signal: AbortSignal.timeout(10_000),
};

function fixture(overrides = {}) {
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", js)(name => {
    assert.equal(name, "server-only");
    return {};
  }, loaded, loaded.exports, { env: { ...defaults, ...overrides } });
  return loaded.exports.createResendStaffInvitationTransport;
}

test("adapter is unavailable without a valid key, GlowFlow sender, and monitored reply-to", () => {
  for (const overrides of [
    { GLOWFLOW_RESEND_API_KEY: "" },
    { GLOWFLOW_RESEND_FROM_EMAIL: "invites@email.mowflow.mocktar.com" },
    { GLOWFLOW_RESEND_FROM_EMAIL: "GlowFlow <invites@email.glowflow.mocktar.com>" },
    { GLOWFLOW_RESEND_REPLY_TO_EMAIL: "" },
    { GLOWFLOW_RESEND_REPLY_TO_EMAIL: "support@glowflow.mocktar.com\r\nBcc: other@example.invalid" },
  ]) {
    assert.equal(fixture(overrides)(() => { throw new Error("must not call network"); }), null);
  }
});

test("accepted send preserves idempotency, both email formats, fragment link, and abort signal", async () => {
  let calls = 0;
  const transport = fixture()(async (url, init) => {
    calls += 1;
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Idempotency-Key"], message.idempotencyKey);
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert.equal(init.signal, message.signal);
    assert.equal(init.cache, "no-store");
    const body = JSON.parse(init.body);
    assert.deepEqual(body.to, [message.to]);
    assert.equal(body.from, "GlowFlow <invites@email.glowflow.mocktar.com>");
    assert.equal(body.reply_to, defaults.GLOWFLOW_RESEND_REPLY_TO_EMAIL);
    assert.equal(body.subject, message.subject);
    assert.equal(body.html, message.html);
    assert.equal(body.text, message.text);
    assert.ok(body.html.includes("#invite=fragment-token"));
    return Response.json({ id: "resend-message-id" });
  });
  assert.deepEqual(await transport(message), { kind: "accepted", messageId: "resend-message-id" });
  assert.equal(calls, 1);
});

test("malformed recipient, invitation key, or signal cannot reach Resend", async () => {
  let calls = 0;
  const transport = fixture()(async () => {
    calls += 1;
    throw new Error("must not call network");
  });
  for (const invalid of [
    { to: "staff@example.invalid\r\nBcc: other@example.invalid" },
    { to: "staff@example.invalid<other@example.invalid>" },
    { idempotencyKey: "" },
    { idempotencyKey: "glowflow-staff-invite-forged" },
    { idempotencyKey: `${message.idempotencyKey}\r\nOther: value` },
    { signal: null },
    { signal: AbortSignal.abort() },
  ]) {
    assert.deepEqual(await transport({ ...message, ...invalid }),
      { kind: "not_sent", retryable: false });
  }
  assert.equal(calls, 0);
});

test("definite request rejection is not_sent; ambiguous outcomes stay unknown", async () => {
  for (const status of [400, 401, 403, 404, 422]) {
    const transport = fixture()(async () => new Response("rejected", { status }));
    assert.deepEqual(await transport(message), { kind: "not_sent", retryable: false });
  }
  for (const status of [409, 429, 500, 503]) {
    const transport = fixture()(async () => new Response("uncertain", { status }));
    assert.deepEqual(await transport(message), { kind: "unknown" });
  }
  for (const reply of ["not-json", "{}", '{"id":"bad\\nheader"}']) {
    const transport = fixture()(async () => new Response(reply, { status: 200 }));
    assert.deepEqual(await transport(message), { kind: "unknown" });
  }
  const transport = fixture()(async () => { throw new Error("private provider detail"); });
  assert.deepEqual(await transport(message), { kind: "unknown" });
});

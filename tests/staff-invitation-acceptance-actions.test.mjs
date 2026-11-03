import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/[locale]/join/actions.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const token = "A".repeat(43);
const form = (fields = {}) => {
  const value = new FormData();
  for (const [key, content] of Object.entries({ token, full_name: "Invited Staff", email: "staff@example.invalid", password: "long-password", ...fields })) {
    value.set(key, content);
  }
  return value;
};

function actions({ enabled = true, verified = true, rpcError = null, authError = null, session = true } = {}) {
  const calls = [];
  const supabase = {
    auth: {
      async getUser() {
        calls.push("getUser");
        return { data: { user: { email_confirmed_at: verified ? "2026-11-03T00:00:00Z" : null } }, error: null };
      },
      async signInWithPassword(value) { calls.push(["signIn", value]); return { error: authError }; },
      async signUp(value) { calls.push(["signUp", value]); return { data: { session: session ? {} : null }, error: authError }; },
    },
    async rpc(name, args) { calls.push(["rpc", name, args]); return { error: rpcError }; },
  };
  const dependencies = {
    "next/navigation": { redirect(location) { throw Object.assign(new Error("redirect"), { location }); } },
    "@/lib/auth": { safeLocale: value => ["fr", "en", "es"].includes(value) ? value : "fr" },
    "@/lib/supabase/server": { async createClient() { calls.push("createClient"); return supabase; } },
    "@/lib/staff-invitations": {
      staffInvitationsEnabled: () => enabled,
      validStaffInvitationToken: value => /^[A-Za-z0-9_-]{43}$/.test(value),
    },
  };
  const loaded = { exports: {} };
  new Function("require", "exports", "process", js)(
    name => {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected import: ${name}`);
      return dependencies[name];
    }, loaded.exports, { env: { GLOWFLOW_APP_URL: "https://glowflow.mocktar.com" } },
  );
  return { actions: loaded.exports, calls };
}

test("disabled and malformed invitation paths never touch Auth or the acceptance RPC", async () => {
  const disabled = actions({ enabled: false });
  assert.deepEqual(await disabled.actions.acceptStaffInvitation("fr", {}, form()), { error: "unavailable" });
  assert.deepEqual(await disabled.actions.signInToAcceptInvitation("fr", {}, form()), { error: "unavailable" });
  assert.deepEqual(await disabled.actions.signUpToAcceptInvitation("fr", {}, form()), { error: "unavailable" });
  assert.deepEqual(disabled.calls, []);

  const invalid = actions();
  assert.deepEqual(await invalid.actions.signInToAcceptInvitation("en", {}, form({ token: "bad" })), { error: "unavailable" });
  assert.deepEqual(await invalid.actions.signUpToAcceptInvitation("en", {}, form({ token: "bad" })), { error: "unavailable" });
  assert.deepEqual(invalid.calls, []);
});

test("existing verified staff sign in and accept without owner onboarding", async () => {
  const fixture = actions();
  await assert.rejects(
    fixture.actions.signInToAcceptInvitation("fr", {}, form()),
    error => error.location === "/fr/dashboard",
  );
  assert.deepEqual(fixture.calls, [
    "createClient",
    ["signIn", { email: "staff@example.invalid", password: "long-password" }],
    "getUser",
    ["rpc", "accept_staff_invitation", {
      raw_token: token, requested_full_name: "Invited Staff", requested_locale: "fr",
    }],
  ]);
});

test("unverified, invalid, expired, revoked or cross-salon acceptance fails closed", async () => {
  for (const fixtureOptions of [{ verified: false }, { rpcError: { message: "staff_invitation_unavailable" } }]) {
    const fixture = actions(fixtureOptions);
    assert.deepEqual(await fixture.actions.acceptStaffInvitation("es", {}, form()), { error: "unavailable" });
    assert.equal(fixture.calls.some(call => Array.isArray(call) && call[0] === "rpc"), fixtureOptions.verified !== false);
  }
  const badAuth = actions({ authError: { message: "private provider detail" } });
  assert.deepEqual(await badAuth.actions.signInToAcceptInvitation("en", {}, form()), { error: "unavailable" });
  assert.ok(!badAuth.calls.some(call => Array.isArray(call) && call[0] === "rpc"));
});

test("new staff signup redirects only to inert completion and never stores token in Auth", async () => {
  const fixture = actions({ session: false });
  await assert.rejects(
    fixture.actions.signUpToAcceptInvitation("en", {}, form()),
    error => error.location === "/en/join/complete",
  );
  const signup = fixture.calls.find(call => Array.isArray(call) && call[0] === "signUp")[1];
  assert.equal(signup.options.emailRedirectTo, "https://glowflow.mocktar.com/auth/callback?next=/en/join/complete");
  assert.ok(!JSON.stringify(signup).includes(token));
  assert.ok(!fixture.calls.some(call => Array.isArray(call) && call[0] === "rpc"));
});

test("new staff without email confirmation never accepts, even when Auth returns a session", async () => {
  const fixture = actions({ session: true, verified: false });
  assert.deepEqual(await fixture.actions.signUpToAcceptInvitation("en", {}, form()), { error: "unavailable" });
  assert.ok(!fixture.calls.some(call => Array.isArray(call) && call[0] === "rpc"));
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/auth.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

function workspace({ intent = "staff_invitation", tenantId = null, membershipError = null } = {}) {
  const calls = [];
  const supabase = {
    auth: { async getUser() {
      calls.push("getUser");
      return { data: { user: {
        id: "invited-user", email: "staff@example.invalid",
        user_metadata: { glowflow_account_intent: intent, full_name: "Staff Member" },
      } }, error: null };
    } },
    from(table) {
      calls.push(["from", table]);
      return { select(columns) {
        calls.push(["select", columns]);
        return { eq(column, value) {
          calls.push(["eq", column, value]);
          return { async maybeSingle() { return { data: tenantId ? { tenant_id: tenantId } : null, error: membershipError }; } };
        } };
      } };
    },
    async rpc(name) { calls.push(["rpc", name]); return { error: null }; },
  };
  const dependencies = {
    "next/navigation": { redirect() { throw new Error("unexpected redirect"); } },
    "@/lib/supabase/server": { async createClient() { return supabase; } },
    "@/lib/i18n": { isLocale: value => ["fr", "en", "es"].includes(value) },
  };
  const loaded = { exports: {} };
  new Function("require", "exports", js)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected import: ${name}`);
    return dependencies[name];
  }, loaded.exports);
  return { ensureOwnerWorkspace: loaded.exports.ensureOwnerWorkspace, calls };
}

test("unassigned invited identity never invokes owner workspace RPC", async () => {
  for (const options of [{}, { membershipError: { message: "denied" } }]) {
    const fixture = workspace(options);
    assert.deepEqual(await fixture.ensureOwnerWorkspace(), { error: "staff_invitation_required" });
    assert.ok(!fixture.calls.some(call => Array.isArray(call) && call[0] === "rpc"));
  }
});

test("accepted staff can use normal sign-in without owner workspace RPC", async () => {
  const fixture = workspace({ tenantId: "salon-id" });
  assert.deepEqual(await fixture.ensureOwnerWorkspace(), { error: null });
  assert.ok(!fixture.calls.some(call => Array.isArray(call) && call[0] === "rpc"));
});

test("normal owner onboarding still uses existing RPC", async () => {
  const fixture = workspace({ intent: "owner" });
  assert.deepEqual(await fixture.ensureOwnerWorkspace(), { error: null });
  assert.ok(fixture.calls.some(call => Array.isArray(call) && call[0] === "rpc" && call[1] === "create_owner_workspace"));
});

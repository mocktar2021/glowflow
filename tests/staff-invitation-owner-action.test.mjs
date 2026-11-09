import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/[locale]/dashboard/team/invitations/actions.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const requestKey = "70000000-0000-4000-8000-000000000001";
const form = (email = "staff@example.invalid", key = requestKey) => {
  const data = new FormData();
  data.set("email", email);
  data.set("request_key", key);
  return data;
};

function fixture({ enabled = true, role = "owner", tenantOwner = "owner-fixture", queueStatus = "queued",
  membershipError = null, tenantError = null, tenantId = "tenant-fixture" } = {}) {
  const calls = [];
  const supabase = { from(table) {
    calls.push(["from", table]);
    return { select() { return { eq() { return { async single() {
      return { data: table === "users"
        ? { tenant_id: tenantId, role }
        : { owner_id: tenantOwner }, error: table === "users" ? membershipError : tenantError };
    } }; } }; } };
  } };
  const dependencies = {
    "next/navigation": {
      notFound() { throw Object.assign(new Error("not found"), { code: 404 }); },
      redirect(location) { throw Object.assign(new Error("redirect"), { location }); },
    },
    "@/lib/auth": {
      safeLocale: value => ["fr", "en", "es"].includes(value) ? value : "fr",
      async requireUser() { calls.push("requireUser"); return { supabase, userId: "owner-fixture" }; },
    },
    "@/lib/staff-invitation-delivery": { async queueStaffInvitationDelivery(email, key) {
      calls.push(["queue", email, key]);
      return { status: queueStatus };
    } },
    "@/lib/staff-invitations": { staffInvitationManagementEnabled: () => enabled },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected import: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return { action: loaded.exports.requestStaffInvitation, calls };
}

test("disabled management never queries membership or queues", async () => {
  const f = fixture({ enabled: false });
  await assert.rejects(f.action("fr", form()), error => error.code === 404);
  assert.deepEqual(f.calls, []);
});

test("staff and mismatched tenant owner cannot queue through the action", async () => {
  for (const options of [{ role: "staff" }, { tenantOwner: "someone-else" }]) {
    const f = fixture(options);
    await assert.rejects(f.action("en", form()), error => error.code === 404);
    assert.ok(!f.calls.some(call => Array.isArray(call) && call[0] === "queue"));
  }
});

test("missing or failed tenant lookups fail closed before invitation delivery", async () => {
  for (const options of [
    { membershipError: new Error("synthetic membership lookup failed") },
    { tenantId: null },
    { tenantError: new Error("synthetic tenant lookup failed") },
    { tenantOwner: null },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.action("fr", form()), error => error.code === 404);
    assert.ok(!f.calls.some(call => Array.isArray(call) && call[0] === "queue"));
  }
});

test("owner sends only validated email and stable request key to the DB wrapper", async () => {
  const f = fixture();
  await assert.rejects(f.action("es", form(" STAFF@Example.Invalid ")), error =>
    error.location === "/es/dashboard/team/invitations?requested=1");
  assert.deepEqual(f.calls.at(-1), ["queue", "STAFF@Example.Invalid", requestKey]);
});

test("invalid input and queue failure show generic status without recipient details", async () => {
  const invalid = fixture();
  await assert.rejects(invalid.action("fr", form("bad email")), error =>
    error.location === "/fr/dashboard/team/invitations?error=unavailable");
  assert.ok(!invalid.calls.some(call => Array.isArray(call) && call[0] === "queue"));

  const failed = fixture({ queueStatus: "unavailable" });
  await assert.rejects(failed.action("en", form()), error =>
    error.location === "/en/dashboard/team/invitations?error=unavailable");
});

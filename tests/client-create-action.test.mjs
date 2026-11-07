import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

import { clientFields, clientIdSchema } from "../lib/client-validation.ts";

const source = await readFile(new URL("../app/[locale]/dashboard/clients/actions.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const ownClientId = "30000000-0000-0000-0000-000000000001";
const redirectSignal = Symbol("Next redirect");

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function actionFixture() {
  const writes = [];
  const revalidated = [];
  const redirects = [];
  const supabase = {
    from(table) {
      assert.equal(table, "clients");
      const query = {
        insert(values) { writes.push(values); return query; },
        select(columns) { assert.equal(columns, "id"); return query; },
        async single() { return { data: { id: ownClientId }, error: null }; },
      };
      return query;
    },
  };
  const exports = {};
  new Function("require", "exports", js)((name) => {
    if (name === "next/cache") return { revalidatePath(path) { revalidated.push(path); } };
    if (name === "next/navigation") return { redirect(path) { redirects.push(path); throw redirectSignal; } };
    if (name === "@/lib/clients") return {
      clientFields, clientIdSchema,
      async clientMember() { return { supabase, tenantId: "tenant-a" }; },
    };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return { saveClient: exports.saveClient, writes, revalidated, redirects };
}

test("valid client create uses the authenticated salon and redirects to its new profile", async () => {
  const fixture = actionFixture();
  const submitted = form({
    full_name: "Synthetic New Client", email: "", phone: "", notes: "", preferred_locale: "es",
    tenant_id: "tenant-b", id: "30000000-0000-0000-0000-000000000002",
  });

  await assert.rejects(fixture.saveClient("en", null, { error: null, saved: false }, submitted),
    (error) => error === redirectSignal);
  assert.deepEqual(fixture.writes, [{
    tenant_id: "tenant-a", full_name: "Synthetic New Client", email: null, phone: null,
    notes: null, preferred_locale: "es",
  }]);
  assert.deepEqual(fixture.revalidated, ["/en/dashboard/clients", `/en/dashboard/clients/${ownClientId}`]);
  assert.deepEqual(fixture.redirects, [`/en/dashboard/clients/${ownClientId}`]);
});

test("invalid contact details stop create before a database write", async () => {
  for (const override of [{ email: "not-an-email" }, { phone: "123" }]) {
    const fixture = actionFixture();
    const submitted = form({
      full_name: "Synthetic New Client", email: "new@example.invalid", phone: "+1 555 010 5678",
      notes: "Synthetic only", preferred_locale: "fr", ...override,
    });
    assert.deepEqual(await fixture.saveClient("fr", null, { error: null, saved: false }, submitted),
      { error: "invalid", saved: false });
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(fixture.revalidated, []);
    assert.deepEqual(fixture.redirects, []);
  }
});

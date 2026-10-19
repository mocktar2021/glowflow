import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

import { clientFields, clientIdSchema } from "../lib/client-validation.ts";

const source = await readFile(new URL("../app/[locale]/dashboard/clients/actions.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const ownId = "30000000-0000-0000-0000-000000000001";
const foreignId = "30000000-0000-0000-0000-000000000002";

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    full_name: "Synthetic Edited Client", email: "edited@example.invalid", phone: "+1 555 010 5678",
    notes: "Synthetic private note", preferred_locale: "es", tenant_id: "tenant-b", id: foreignId,
  })) data.set(key, value);
  return data;
}

function editFixture() {
  const queries = [];
  const revalidated = [];
  const rows = [{ id: ownId, tenant_id: "tenant-a" }, { id: foreignId, tenant_id: "tenant-b" }];
  const supabase = {
    from(table) {
      assert.equal(table, "clients");
      const query = { values: null, filters: [], columns: null };
      queries.push(query);
      const builder = {
        update(values) { query.values = values; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        select(columns) { query.columns = columns; return builder; },
        async maybeSingle() {
          const match = rows.find((row) => query.filters.every(([column, value]) => row[column] === value));
          return { data: match ? { id: match.id } : null, error: null };
        },
      };
      return builder;
    },
  };
  const exports = {};
  new Function("require", "exports", js)((name) => {
    if (name === "next/cache") return { revalidatePath(path) { revalidated.push(path); } };
    if (name === "next/navigation") return { redirect() { throw new Error("Unexpected redirect"); } };
    if (name === "@/lib/clients") return {
      clientFields, clientIdSchema,
      async clientMember() { return { supabase, tenantId: "tenant-a" }; },
    };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return { saveClient: exports.saveClient, queries, revalidated };
}

test("profile edit updates only the authenticated salon's selected client", async () => {
  const fixture = editFixture();
  assert.deepEqual(await fixture.saveClient("en", ownId, { error: null, saved: false }, form()),
    { error: null, saved: true });
  assert.deepEqual(fixture.queries, [{
    values: {
      full_name: "Synthetic Edited Client", email: "edited@example.invalid", phone: "+1 555 010 5678",
      notes: "Synthetic private note", preferred_locale: "es",
    },
    filters: [["tenant_id", "tenant-a"], ["id", ownId]], columns: "id",
  }]);
  assert.deepEqual(fixture.revalidated, ["/en/dashboard/clients", `/en/dashboard/clients/${ownId}`]);
});

test("foreign profile edit finds no row and never reports success", async () => {
  const fixture = editFixture();
  assert.deepEqual(await fixture.saveClient("fr", foreignId, { error: null, saved: false }, form()),
    { error: "save", saved: false });
  assert.deepEqual(fixture.queries[0].filters, [["tenant_id", "tenant-a"], ["id", foreignId]]);
  assert.deepEqual(fixture.revalidated, []);
});

test("malformed profile ID stops before database access", async () => {
  const fixture = editFixture();
  assert.deepEqual(await fixture.saveClient("es", "../tenant-b", { error: null, saved: false }, form()),
    { error: "invalid", saved: false });
  assert.deepEqual(fixture.queries, []);
  assert.deepEqual(fixture.revalidated, []);
});

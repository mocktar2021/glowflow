import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/clients.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const loaded = { exports: {} };
new Function("require", "exports", js)((name) => {
  if (name === "next/navigation") return { redirect() { throw new Error("Unexpected redirect"); } };
  if (name === "@/lib/auth") return { requireUser() { throw new Error("Unexpected auth call"); } };
  if (name === "./client-validation") return {};
  throw new Error(`Unexpected import: ${name}`);
}, loaded.exports);
const { findClients } = loaded.exports;

test("every client search field stays tenant-scoped, bounded, and deduplicated", async () => {
  const rows = [
    { id: "own-a", tenant_id: "tenant-a", full_name: "Alpha 555", email: "alpha@example.invalid", phone: "+1 555 010 1000", preferred_locale: "fr" },
    { id: "own-b", tenant_id: "tenant-a", full_name: "Beta Fixture", email: "beta555@example.invalid", phone: "+1 555 010 2000", preferred_locale: "es" },
    { id: "own-c", tenant_id: "tenant-a", full_name: "Gamma Fixture", email: "gamma@example.invalid", phone: "+1 222 010 3000", preferred_locale: "en" },
    { id: "foreign", tenant_id: "tenant-b", full_name: "Foreign 555", email: "foreign555@example.invalid", phone: "+1 555 010 4000", preferred_locale: "en" },
  ];
  const queries = [];
  const supabase = {
    from(table) {
      assert.equal(table, "clients");
      const query = { columns: null, filters: [], match: null, order: null, limit: null };
      queries.push(query);
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        ilike(column, pattern) { query.match = [column, pattern]; return builder; },
        order(column) { query.order = column; return builder; },
        limit(count) {
          query.limit = count;
          const matches = rows.filter((row) => query.filters.every(([column, value]) => row[column] === value)
            && (!query.match || String(row[query.match[0]] ?? "").toLowerCase().includes(query.match[1].slice(1, -1).toLowerCase())));
          const data = matches.sort((a, b) => a.full_name.localeCompare(b.full_name)).slice(0, count)
            .map((row) => Object.fromEntries(query.columns.split(",").map((column) => [column, row[column]])));
          return Promise.resolve({ data, error: null });
        },
      };
      return builder;
    },
  };

  const found = await findClients(supabase, "tenant-a", "555");
  assert.deepEqual(found.map(({ id }) => id), ["own-a", "own-b"]);
  assert.deepEqual(queries.map(({ match }) => match), [
    ["full_name", "%555%"], ["email", "%555%"], ["phone", "%555%"],
  ]);
  for (const query of queries) {
    assert.deepEqual(query.filters, [["tenant_id", "tenant-a"]]);
    assert.equal(query.columns, "id,full_name,phone,email,preferred_locale");
    assert.equal(query.order, "full_name");
    assert.equal(query.limit, 30);
  }
});

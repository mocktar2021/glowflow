import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = await readFile(new URL("../lib/billing/owner-authorization.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const ownerId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";

function fixture({ auth = { data: { user: { id: ownerId } }, error: null },
  member = { data: { id: ownerId, tenant_id: tenantId, role: "owner" }, error: null },
  tenant = { data: { id: tenantId, owner_id: ownerId, country_code: "FR", currency: "EUR" }, error: null },
  createError = false, authError = false, queryError = false } = {}) {
  const queries = [];
  const client = {
    auth: { getUser: async () => {
      if (authError) throw new Error("auth unavailable");
      return auth;
    } },
    from(table) {
      if (queryError) throw new Error("database unavailable");
      const query = { table, select: null, field: null, value: null };
      queries.push(query);
      return {
        select(fields) { query.select = fields; return this; },
        eq(field, value) { query.field = field; query.value = value; return this; },
        async single() { return table === "users" ? member : tenant; },
      };
    },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (name) => {
      if (name === "server-only") return {};
      if (name === "@/lib/supabase/server") return {
        createClient: async () => {
          if (createError) throw new Error("session unavailable");
          return client;
        },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    }, loaded, loaded.exports,
  );
  return { resolve: loaded.exports.resolveBillingOwnerContext, queries, client };
}

test("trusted owner and salon records determine the sole billing context", async () => {
  const { resolve, queries, client } = fixture();
  assert.equal(resolve.length, 0);
  const result = await resolve({ tenantId: otherId, countryCode: "US", currency: "USD",
    priceId: "price_attacker", stripeCustomerId: "cus_attacker" });
  assert.deepEqual(result, {
    kind: "owner", ownerId, tenantId, operatingCountryCode: "FR",
    operatingCurrency: "EUR", supabase: client,
  });
  assert.deepEqual(queries, [
    { table: "users", select: "id,tenant_id,role", field: "id", value: ownerId },
    { table: "tenants", select: "id,owner_id,country_code,currency", field: "id", value: tenantId },
  ]);
});

test("anonymous, malformed, and unavailable auth never read the tenant", async () => {
  for (const options of [
    { auth: { data: { user: null }, error: null } },
    { auth: { data: { user: { id: "not-a-uuid" } }, error: null } },
    { auth: { data: { user: { id: ownerId } }, error: { message: "failure" } } },
    { authError: true }, { createError: true },
  ]) {
    const { resolve, queries } = fixture(options);
    assert.equal((await resolve()).kind, options.authError || options.createError
      || options.auth?.error ? "unavailable" : "authentication_required");
    assert.deepEqual(queries, []);
  }
});

test("staff, absent membership, and hostile membership cannot reach the salon lookup", async () => {
  for (const data of [
    null,
    { id: ownerId, tenant_id: tenantId, role: "staff" },
    { id: ownerId, tenant_id: tenantId, role: "admin" },
    { id: otherId, tenant_id: tenantId, role: "owner" },
    { id: ownerId, tenant_id: "attacker-tenant", role: "owner" },
  ]) {
    const { resolve, queries } = fixture({ member: { data, error: null } });
    assert.deepEqual(await resolve(), { kind: "owner_required" });
    assert.equal(queries.length, 1);
    assert.equal(queries[0].table, "users");
  }
});

test("a different tenant or owner cannot be used for billing", async () => {
  for (const data of [
    null,
    { id: otherId, owner_id: ownerId, country_code: "FR", currency: "EUR" },
    { id: tenantId, owner_id: otherId, country_code: "FR", currency: "EUR" },
  ]) {
    const { resolve, queries } = fixture({ tenant: { data, error: null } });
    assert.deepEqual(await resolve(), { kind: "owner_required" });
    assert.equal(queries.length, 2);
    assert.equal(queries[1].value, tenantId);
  }
});

test("query failures and malformed operating market fail closed", async () => {
  for (const options of [
    { member: { data: null, error: { message: "failure" } } },
    { tenant: { data: null, error: { message: "failure" } } },
    { queryError: true },
    { tenant: { data: { id: tenantId, owner_id: ownerId, country_code: "France", currency: "EUR" }, error: null } },
    { tenant: { data: { id: tenantId, owner_id: ownerId, country_code: "FR", currency: "eur" }, error: null } },
  ]) {
    const { resolve } = fixture(options);
    assert.deepEqual(await resolve(), { kind: "unavailable" });
  }
});

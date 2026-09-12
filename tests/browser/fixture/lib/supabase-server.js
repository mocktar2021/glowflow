import { cookies } from "next/headers";

// Test-only adapter. Only the isolated fixture webpack config aliases this module.
// Identities are fictitious; there is no connection to Supabase or a real session.
export async function createClient() {
  const identity = (await cookies()).get("fixture-identity")?.value;
  const identities = { owner: "owner-a", staff: "staff-a", "cross-tenant": "outsider", "query-error": "owner-a" };
  const userId = identities[identity];
  const tenants = [{ id: "tenant-a", owner_id: "owner-a" }, { id: "tenant-b", owner_id: "owner-b" }];
  return {
    auth: { async getClaims() { return { data: userId ? { claims: { sub: userId } } : null }; } },
    from(table) {
      if (table !== "tenants") throw new Error("Unexpected fixture table");
      let rows = tenants;
      return {
        select(fields) {
          if (fields !== "id") throw new Error("Unexpected fixture projection");
          return this;
        },
        eq(field, value) {
          if (field !== "owner_id") throw new Error("Unexpected fixture filter");
          rows = rows.filter(row => row.owner_id === value);
          return this;
        },
        async single() {
          if (identity === "query-error") return { data: null, error: { message: "Fictional database diagnostic" } };
          return rows.length === 1 ? { data: { id: rows[0].id }, error: null } : { data: null, error: { message: "Expected exactly one row" } };
        },
      };
    },
  };
}

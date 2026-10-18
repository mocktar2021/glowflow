import { cookies } from "next/headers";

// Test-only adapter. Only the isolated fixture webpack config aliases this module.
// Identities and history are fictitious; there is no Supabase connection.
export async function createClient() {
  const identity = (await cookies()).get("fixture-identity")?.value;
  const identities = { owner: "owner-a", staff: "staff-a", "cross-tenant": "outsider", "query-error": "owner-a" };
  const userId = identities[identity];
  const members = [
    { id: "owner-a", tenant_id: "tenant-a", role: "owner" },
    { id: "staff-a", tenant_id: "tenant-a", role: "staff" },
  ];
  const tenantId = members.find((member) => member.id === userId)?.tenant_id;
  const tables = {
    users: members,
    clients: [{ id: "client-a", tenant_id: "tenant-a", full_name: "Fixture Client" }],
    client_notification_consent_events: [{ id: "consent-fixture", tenant_id: "tenant-a", client_id: "client-a", channel: "email", consent_status: "consented", occurred_at: "2030-06-14T12:00:00Z" }],
    notification_delivery_attempts: [{ id: "attempt-fixture", tenant_id: "tenant-a", outbox_id: "message-fixture", event_type: "delivered", attempt_number: 1, occurred_at: "2030-06-15T12:00:00Z", error_code: null }],
  };
  return {
    auth: { async getClaims() { return { data: userId ? { claims: { sub: userId } } : null }; } },
    from(table) {
      if (!(table in tables)) throw new Error("Unexpected fixture table");
      let rows = tables[table].filter((row) => row.tenant_id === tenantId);
      return {
        select() { return this; },
        eq(field, value) { rows = rows.filter((row) => row[field] === value); return this; },
        in(field, values) { rows = rows.filter((row) => values.includes(row[field])); return this; },
        order(field, { ascending = true } = {}) { rows.sort((a, b) => ascending ? String(a[field]).localeCompare(String(b[field])) : String(b[field]).localeCompare(String(a[field]))); return this; },
        limit(count) { rows = rows.slice(0, count); return this; },
        async single() {
          if (identity === "query-error") return { data: null, error: { message: "Fictional database diagnostic" } };
          return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "Expected exactly one row" } };
        },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
      };
    },
    async rpc(name, { target_tenant_id: requestedTenant }) {
      if (name !== "get_notification_status_rows" || requestedTenant !== tenantId) return { data: null, error: { message: "Not authorized" } };
      return { data: [{
        id: "message-fixture", appointment_id: "appointment-fixture", client_id: "client-a",
        appointment_start_time: "2030-06-15T12:00:00Z", schedule_generation: 0,
        notification_kind: "confirmation", channel: "email", scheduled_for: "2030-06-15T12:00:00Z",
        appointment_status: "confirmed", current_appointment_start_time: "2030-06-15T12:00:00Z",
        current_schedule_generation: 0, consent_status: "consented", latest_event_type: "delivered",
        latest_retry_after: null, latest_lease_expires_at: null, latest_occurred_at: "2030-06-15T12:00:00Z",
        attempt_count: 1,
      }], error: null };
    },
  };
}

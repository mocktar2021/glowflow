import { cookies } from "next/headers";

// Test-only adapter. Only the isolated fixture webpack config aliases this module.
// Identities and history are fictitious; there is no Supabase connection.
export async function createClient() {
  const identity = (await cookies()).get("fixture-identity")?.value;
  const identities = { owner: "owner-a", staff: "staff-a", "staff-no-insert": "staff-a", "cross-tenant": "outsider", "query-error": "owner-a", "payment-error": "owner-a" };
  const userId = identities[identity];
  const members = [
    { id: "owner-a", tenant_id: "tenant-a", role: "owner", full_name: "Fixture Owner" },
    { id: "staff-a", tenant_id: "tenant-a", role: "staff", full_name: "Fixture Staff" },
  ];
  const tenantId = members.find((member) => member.id === userId)?.tenant_id;
  const tables = {
    users: members,
    tenants: [{ id: "tenant-a", tenant_id: "tenant-a", owner_id: "owner-a", name: "Fixture Salon", country_code: "US", currency: "USD", time_zone: "America/New_York" }],
    clients: [
      { id: "client-a", tenant_id: "tenant-a", full_name: "Fixture Client" },
      { id: "30000000-0000-0000-0000-000000000001", tenant_id: "tenant-a", full_name: "Synthetic Alice", email: "alice@example.invalid", phone: "+1 555 010 1234", notes: "Synthetic private note", nail_preferences: { shape: "Almond", product_type: "Gel", shade: "Rose gold", design_notes: "Synthetic floral design <img src=x onerror=alert(1)>", last_infill_date: "2030-06-01", private_photo_tokens: "SYNTHETIC-NAIL-PRIVATE-DO-NOT-SERIALIZE" }, preferred_locale: "fr", created_at: "2030-01-01T00:00:00Z" },
      { id: "30000000-0000-0000-0000-000000000002", tenant_id: "tenant-b", full_name: "Synthetic Foreign", email: "foreign@example.invalid", phone: null, notes: "Foreign private note", nail_preferences: { shade: "Foreign nail secret" }, preferred_locale: "en", created_at: "2030-01-01T00:00:00Z" },
      ...Object.values(globalThis.__glowflowFixtureCreatedClients ?? {}),
    ],
    appointments: [
      { id: "50000000-0000-0000-0000-000000000001", tenant_id: "tenant-a", client_id: "30000000-0000-0000-0000-000000000001", service_id: "40000000-0000-0000-0000-000000000001", staff_id: "staff-a", service_title_json: { fr: "Coupe fictive", en: "Synthetic haircut", es: "Corte ficticio" }, service_price: 5000, service_currency: "USD", start_time: "2030-06-14T12:00:00Z", end_time: "2030-06-14T13:00:00Z", status: "completed", deposit_paid: false, station_name: null },
      { id: "50000000-0000-0000-0000-000000000002", tenant_id: "tenant-a", client_id: "30000000-0000-0000-0000-000000000001", service_id: "40000000-0000-0000-0000-000000000001", staff_id: "staff-a", service_title_json: { fr: "Paiement fictif", en: "Synthetic checkout", es: "Cobro ficticio" }, service_price: 4000, service_currency: "USD", start_time: "2030-06-15T12:00:00Z", end_time: "2030-06-15T13:00:00Z", status: globalThis.__glowflowFixtureAppointmentStatus ?? "confirmed", deposit_paid: false, station_name: null },
    ],
    services: [{ id: "40000000-0000-0000-0000-000000000001", tenant_id: "tenant-a", title_json: { fr: "Paiement fictif", en: "Synthetic checkout", es: "Cobro ficticio" }, price: 4000, deposit_amount: 0, currency: "USD", station_name: null, is_active: true, created_at: "2030-01-01T00:00:00Z" }],
    stripe_sandbox_connections: [],
    client_notification_consent_events: [{ id: "consent-fixture", tenant_id: "tenant-a", client_id: "client-a", channel: "email", consent_status: "consented", occurred_at: "2030-06-14T12:00:00Z" }],
    notification_delivery_attempts: [{ id: "attempt-fixture", tenant_id: "tenant-a", outbox_id: "message-fixture", event_type: "delivered", attempt_number: 1, occurred_at: "2030-06-15T12:00:00Z", error_code: null }],
  };
  return {
    auth: { async getClaims() { return { data: userId ? { claims: { sub: userId } } : null }; }, async getUser() { return { data: { user: userId ? { id: userId } : null }, error: null }; } },
    from(table) {
      if (!(table in tables)) throw new Error("Unexpected fixture table");
      let rows = tables[table].filter((row) => row.tenant_id === tenantId);
      let updateValues = null;
      let insertValues = null;
      return {
        select() { return this; },
        update(values) { updateValues = values; return this; },
        insert(values) {
          if (table !== "clients" || identity === "staff-no-insert") throw new Error("Unexpected fixture client insert");
          insertValues = values;
          return this;
        },
        eq(field, value) { rows = rows.filter((row) => row[field] === value); return this; },
        neq(field, value) { rows = rows.filter((row) => row[field] !== value); return this; },
        gte(field, value) { rows = rows.filter((row) => String(row[field]) >= value); return this; },
        lt(field, value) { rows = rows.filter((row) => String(row[field]) < value); return this; },
        ilike(field, pattern) { const term = pattern.replace(/^%|%$/g, "").toLocaleLowerCase(); rows = rows.filter((row) => String(row[field] ?? "").toLocaleLowerCase().includes(term)); return this; },
        in(field, values) { rows = rows.filter((row) => values.includes(row[field])); return this; },
        order(field, { ascending = true } = {}) { rows.sort((a, b) => ascending ? String(a[field]).localeCompare(String(b[field])) : String(b[field]).localeCompare(String(a[field]))); return this; },
        limit(count) { rows = rows.slice(0, count); return this; },
        async single() {
          if (identity === "query-error") return { data: null, error: { message: "Fictional database diagnostic" } };
          if (insertValues) {
            if (insertValues.tenant_id !== tenantId || tenantId !== "tenant-a") throw new Error("Fixture insert escaped the active tenant");
            const ids = { fr: "30000000-0000-4000-8000-000000000011", en: "30000000-0000-4000-8000-000000000012", es: "30000000-0000-4000-8000-000000000013" };
            const id = ids[insertValues.preferred_locale];
            if (!id || !insertValues.full_name?.startsWith("Synthetic New ") || !insertValues.email?.endsWith("@example.invalid")) throw new Error("Unexpected fixture client payload");
            const created = { ...insertValues, id, created_at: "2030-01-01T00:00:00Z" };
            globalThis.__glowflowFixtureCreatedClients ??= {};
            globalThis.__glowflowFixtureCreatedClients[id] = created;
            return { data: { id }, error: null };
          }
          return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "Expected exactly one row" } };
        },
        async maybeSingle() {
          if (identity === "query-error") return { data: null, error: { message: "Fictional database diagnostic" } };
          return rows.length <= 1 ? { data: rows[0] ? { ...rows[0], ...updateValues } : null, error: null } : { data: null, error: { message: "Expected at most one row" } };
        },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
      };
    },
    async rpc(name, args = {}) {
      const { target_tenant_id: requestedTenant } = args;
      if (name === "get_appointment_payment_summaries") {
        const payments = globalThis.__glowflowFixturePayments ?? [];
        const ids = args.target_appointment_ids ?? [];
        return { data: ids.map((id) => {
          const paid = payments.filter((entry) => entry.appointmentId === id).reduce((sum, entry) => sum + entry.amount, 0);
          return { appointment_id: id, currency: "USD", paid_amount: paid, refunded_amount: 0, net_paid_amount: paid };
        }), error: null };
      }
      if (name === "record_manual_appointment_payment") {
        if (identity !== "owner" && identity !== "payment-error") return { data: null, error: { message: "Not authorized" } };
        if (identity === "payment-error") return { data: null, error: { message: "payment_exceeds_outstanding_balance" } };
        const payments = globalThis.__glowflowFixturePayments ??= [];
        const appointmentId = "50000000-0000-0000-0000-000000000002";
        if (args.target_appointment_id !== appointmentId || !["cash", "external_card"].includes(args.target_payment_method)
          || !Number.isInteger(args.target_amount) || args.target_amount <= 0) {
          return { data: null, error: { message: "Invalid synthetic payment" } };
        }
        const previous = payments.find((entry) => entry.key === args.request_key);
        if (previous) return previous.appointmentId === appointmentId
          && previous.method === args.target_payment_method && previous.amount === args.target_amount
          ? { data: null, error: null }
          : { data: null, error: { message: "payment_idempotency_key_reuse" } };
        const paid = payments.filter((entry) => entry.appointmentId === appointmentId).reduce((sum, entry) => sum + entry.amount, 0);
        if (globalThis.__glowflowFixtureAppointmentStatus === "canceled") return { data: null, error: { message: "payment_appointment_not_found" } };
        if (paid + args.target_amount > 4000) return { data: null, error: { message: "payment_exceeds_outstanding_balance" } };
        payments.push({ appointmentId, method: args.target_payment_method, amount: args.target_amount, key: args.request_key });
        return { data: null, error: null };
      }
      if (name === "cancel_calendar_appointment") {
        if (!["owner", "staff"].includes(identity) || args.target_appointment_id !== "50000000-0000-0000-0000-000000000002") {
          return { data: null, error: { message: "Not authorized" } };
        }
        globalThis.__glowflowFixtureAppointmentStatus = "canceled";
        return { data: null, error: null };
      }
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

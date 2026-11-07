import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
async function load(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", js)((name) => dependencies[name] ?? require(name), loaded.exports);
  return loaded.exports;
}

test("notification history admits tenant staff and owners but fails closed for outsiders", async () => {
  for (const scenario of ["anonymous", "staff", "cross-tenant", "query-error", "owner"]) {
    const calls = [];
    const query = (table) => ({
      select(fields) { calls.push(["select", table, fields]); return this; },
      eq(field, value) { calls.push(["eq", table, field, value]); return this; },
      order() { return this; },
      limit() { return this; },
      async single() { return { data: ["owner", "staff"].includes(scenario) ? { tenant_id: "own-tenant", role: scenario } : null, error: scenario === "query-error" ? new Error("database detail") : null }; },
      then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
    });
    const { default: Page } = await load("../app/[locale]/dashboard/notifications/page.tsx", {
      "next/navigation": { notFound() { throw new Error("not-found"); }, redirect(path) { throw new Error(`redirect:${path}`); } },
      "@/lib/i18n": { isLocale: (value) => ["fr", "en", "es"].includes(value) },
      "@/lib/auth": { async requireUser(locale) { calls.push(["auth", locale]); if (scenario === "anonymous") throw new Error(`redirect:/${locale}/login`); return { userId: "current-user", supabase: { from(table) { calls.push(["from", table]); return query(table); }, async rpc(name, args) { calls.push(["rpc", name, args.target_tenant_id]); return { data: [], error: null }; } } }; } },
      "@/components/glowflow/notification-template-preview": { NotificationTemplatePreview: "preview" },
      "@/lib/notifications/status": { deriveNotificationStatus() { throw new Error("unused"); } },
    });
    if (["owner", "staff"].includes(scenario)) {
      const result = await Page({ params: Promise.resolve({ locale: "en" }) });
      assert.deepEqual(result.props, { locale: "en", records: [], consents: [], attempts: [], historyUnavailable: false });
      assert.ok(calls.some((call) => call[0] === "rpc" && call[1] === "get_notification_status_rows" && call[2] === "own-tenant"));
      for (const table of ["client_notification_consent_events", "notification_delivery_attempts"]) {
        assert.ok(calls.some((call) => call[0] === "eq" && call[1] === table && call[2] === "tenant_id" && call[3] === "own-tenant"));
      }
    } else {
      await assert.rejects(Page({ params: Promise.resolve({ locale: "en" }) }), new RegExp(scenario === "anonymous" ? "redirect:/en/login" : "redirect:/en/dashboard"));
      assert.ok(!calls.some((call) => call[0] === "rpc"));
    }
    assert.deepEqual(calls[0], ["auth", "en"]);
    if (scenario === "anonymous") assert.equal(calls.length, 1);
    else assert.deepEqual(calls.slice(1, 4), [["from", "users"], ["select", "users", "tenant_id,role"], ["eq", "users", "id", "current-user"]]);
    calls.length = 0;
    await assert.rejects(Page({ params: Promise.resolve({ locale: "de" }) }), /not-found/);
    assert.equal(calls.length, 0);
  }
});

test("history page reports unavailable persistence without exposing query diagnostics", async () => {
  const builder = (table) => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, single: async () => ({ data: { tenant_id: "tenant", role: "owner" }, error: null }), then(resolve, reject) { return Promise.resolve({ data: table === "clients" ? [] : null, error: new Error("private SQL diagnostic") }).then(resolve, reject); } });
  const { default: Page } = await load("../app/[locale]/dashboard/notifications/page.tsx", {
    "next/navigation": { notFound() { throw new Error("not-found"); }, redirect(path) { throw new Error(`redirect:${path}`); } },
    "@/lib/i18n": { isLocale: () => true },
    "@/lib/auth": { async requireUser() { return { userId: "owner", supabase: { from(table) { return builder(table); }, async rpc() { return { data: null, error: new Error("private SQL diagnostic") }; } } }; } },
    "@/components/glowflow/notification-template-preview": { NotificationTemplatePreview: "preview" },
    "@/lib/notifications/status": { deriveNotificationStatus() { throw new Error("unused"); } },
  });
  const result = await Page({ params: Promise.resolve({ locale: "fr" }) });
  assert.equal(result.props.statusUnavailable, true);
  assert.equal(result.props.historyUnavailable, true);
  assert.ok(!JSON.stringify(result.props).includes("private SQL diagnostic"));
});

test("staff history maps a recorded opt-out and audit events without a send operation", async () => {
  const calls = [];
  const rows = {
    client_notification_consent_events: [{ id: "consent-2", client_id: "client-1", channel: "email", consent_status: "opted_out", occurred_at: "2030-06-14T12:00:00Z" }],
    notification_delivery_attempts: [{ id: "attempt-1", outbox_id: "outbox-1", event_type: "retryable", attempt_number: 1, occurred_at: "2030-06-14T11:00:00Z", error_code: "temporary_unavailable" }],
    clients: [{ id: "client-1", full_name: "Synthetic Client" }],
  };
  const query = (table) => ({
    select() { return this; },
    eq(field, value) { calls.push(["eq", table, field, value]); return this; },
    order() { return this; },
    limit() { return this; },
    in(field, values) { calls.push(["in", table, field, values]); return this; },
    async single() { return { data: { tenant_id: "own-tenant", role: "staff" }, error: null }; },
    then(resolve, reject) { return Promise.resolve({ data: rows[table], error: null }).then(resolve, reject); },
  });
  const { deriveNotificationStatus } = await load("../lib/notifications/status.ts");
  const { default: Page } = await load("../app/[locale]/dashboard/notifications/page.tsx", {
    "next/navigation": { notFound() { throw new Error("not-found"); }, redirect(path) { throw new Error(`redirect:${path}`); } },
    "@/lib/i18n": { isLocale: (value) => value === "en" },
    "@/lib/auth": { async requireUser() { return { userId: "staff-1", supabase: {
      from(table) { calls.push(["from", table]); return query(table); },
      async rpc(name, args) {
        calls.push(["rpc", name, args]);
        return { data: [{ id: "outbox-1", appointment_id: "appointment-1", client_id: "client-1", appointment_start_time: "2030-06-15T12:00:00Z", schedule_generation: 1, notification_kind: "confirmation", channel: "email", scheduled_for: "2030-06-14T12:00:00Z", appointment_status: "confirmed", current_appointment_start_time: "2030-06-15T12:00:00Z", current_schedule_generation: 1, consent_status: "opted_out", latest_event_type: "retryable", latest_retry_after: "2030-06-14T12:00:00Z", latest_lease_expires_at: null, latest_occurred_at: "2030-06-14T11:00:00Z", attempt_count: 1 }], error: null };
      },
    } }; } },
    "@/components/glowflow/notification-template-preview": { NotificationTemplatePreview: "preview" },
    "@/lib/notifications/status": { deriveNotificationStatus },
  });
  const result = await Page({ params: Promise.resolve({ locale: "en" }) });
  assert.equal(result.props.records[0].status, "opted_out");
  assert.equal(result.props.records[0].clientName, "Synthetic Client");
  assert.deepEqual(result.props.consents, [{ id: "consent-2", clientName: "Synthetic Client", channel: "email", status: "opted_out", occurredAt: "2030-06-14T12:00:00Z" }]);
  assert.deepEqual(result.props.attempts, [{ id: "attempt-1", outboxId: "outbox-1", eventType: "retryable", attemptNumber: 1, occurredAt: "2030-06-14T11:00:00Z", errorCode: "temporary_unavailable" }]);
  assert.deepEqual(calls.filter((call) => call[0] === "rpc"), [["rpc", "get_notification_status_rows", { target_tenant_id: "own-tenant", row_limit: 100 }]]);
  for (const table of ["client_notification_consent_events", "notification_delivery_attempts", "clients"]) {
    assert.ok(calls.some((call) => call[0] === "eq" && call[1] === table && call[2] === "tenant_id" && call[3] === "own-tenant"));
  }
  assert.deepEqual(calls.find((call) => call[0] === "in"), ["in", "clients", "id", ["client-1"]]);
});

test("preview identifies fictitious data in all interface languages and escapes template text", async () => {
  for (const [locale, label] of [["fr", "données fictives"], ["en", "fictitious data"], ["es", "datos ficticios"]]) {
    let supplied;
    const { NotificationTemplatePreview } = await load("../components/glowflow/notification-template-preview.tsx", {
      react: { useState: (initial) => [initial, () => {}] },
      "next/link": ({ children }) => children,
      "@/lib/notifications/templates": { renderNotification(input) { supplied = input; return { locale: "es", text: "<script>unsafe</script>" }; } },
    });
    const html = renderToStaticMarkup(NotificationTemplatePreview({ locale }));
    assert.ok(html.includes(label));
    assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
    assert.ok(html.includes('lang="es"'));
    assert.ok(html.includes('role="status"'));
    assert.ok(html.includes(locale === "fr" ? "Envoi désactivé" : locale === "en" ? "Sending disabled" : "Envío desactivado"));
    assert.equal(supplied.clientLocale, locale);
    assert.equal(supplied.salonLocale, "fr");
    assert.equal(supplied.kind, "confirmation");
    assert.ok(!html.includes("<form"));
    assert.ok(!html.includes("<button"));
  }
});

test("read-only status and audit history are truthful, localized, and contain no send control", async () => {
  const { NotificationTemplatePreview } = await load("../components/glowflow/notification-template-preview.tsx", {
    react: { useState: (initial) => [initial, () => {}] },
    "next/link": ({ children }) => children,
    "@/lib/notifications/templates": { renderNotification() { return { locale: "en", text: "safe preview" }; } },
  });
  const html = renderToStaticMarkup(NotificationTemplatePreview({
    locale: "en",
    records: [{ id: "row", appointmentId: "appointment-a", clientName: "Fixture Client", kind: "confirmation", channel: "email", scheduledFor: "2030-06-15T12:00:00Z", status: "awaiting_consent", attemptCount: 1 }],
    consents: [{ id: "consent-a", clientName: "Fixture Client", channel: "email", status: "opted_out", occurredAt: "2030-06-14T12:00:00Z" }],
    attempts: [{ id: "attempt-a", outboxId: "row", eventType: "retryable", attemptNumber: 1, occurredAt: "2030-06-15T12:00:00Z", errorCode: "temporary_unavailable" }],
  }));
  assert.ok(html.includes("No recorded consent"));
  assert.ok(html.includes("Sending disabled"));
  assert.ok(html.includes("Booking confirmation · EMAIL"));
  assert.ok(html.includes("Consent history"));
  assert.ok(html.includes("Opt-out recorded"));
  assert.ok(html.includes("Delivery attempts"));
  assert.ok(html.includes("temporary_unavailable"));
  assert.ok(html.includes("consent-a") && html.includes("attempt-a"));
  assert.ok(html.includes("The consent source is not yet recorded."));
  assert.ok(!html.includes("Send now"));
  assert.ok(!html.includes("<form"));
});

test("preview shows a safe error instead of renderer diagnostics", async () => {
  const { NotificationTemplatePreview } = await load("../components/glowflow/notification-template-preview.tsx", {
    react: { useState: (initial) => [initial, () => {}] },
    "next/link": ({ children }) => children,
    "@/lib/notifications/templates": { renderNotification() { throw new Error("private diagnostic"); } },
  });
  const html = renderToStaticMarkup(NotificationTemplatePreview({ locale: "en" }));
  assert.ok(html.includes("This preview could not be generated."));
  assert.ok(!html.includes("private diagnostic"));
});

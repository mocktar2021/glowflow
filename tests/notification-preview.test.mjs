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

test("notification page requires an authenticated owner and fails closed on tenant query errors", async () => {
  for (const scenario of ["anonymous", "staff", "cross-tenant", "query-error", "owner"]) {
    const calls = [];
    const tenantBuilder = {
      select(fields) { calls.push(["select", fields]); return this; },
      eq(field, value) { calls.push(["eq", field, value]); return this; },
      async single() { return { data: ["owner", "query-error"].includes(scenario) ? { id: "owned-tenant" } : null, error: scenario === "query-error" ? new Error("database detail") : null }; },
    };
    const { default: Page } = await load("../app/[locale]/dashboard/notifications/page.tsx", {
      "next/navigation": { notFound() { throw new Error("not-found"); }, redirect(path) { throw new Error(`redirect:${path}`); } },
      "@/lib/i18n": { isLocale: (value) => ["fr", "en", "es"].includes(value) },
      "@/lib/auth": { async requireUser(locale) { calls.push(["auth", locale]); if (scenario === "anonymous") throw new Error(`redirect:/${locale}/login`); return { userId: "current-user", supabase: { from(table) { calls.push(["from", table]); return tenantBuilder; }, async rpc(name) { calls.push(["rpc", name]); return { data: [], error: null }; } } }; } },
      "@/components/glowflow/notification-template-preview": { NotificationTemplatePreview: "preview" },
      "@/lib/notifications/status": { deriveNotificationStatus() { throw new Error("unused"); } },
    });
    if (scenario === "owner") {
      const result = await Page({ params: Promise.resolve({ locale: "en" }) });
      assert.deepEqual(result.props, { locale: "en", records: [] });
    } else {
      await assert.rejects(Page({ params: Promise.resolve({ locale: "en" }) }), new RegExp(scenario === "anonymous" ? "redirect:/en/login" : "redirect:/en/dashboard"));
    }
    assert.deepEqual(calls[0], ["auth", "en"]);
    if (scenario === "anonymous") assert.equal(calls.length, 1);
    else if (scenario !== "owner") assert.deepEqual(calls.slice(1), [["from", "tenants"], ["select", "id"], ["eq", "owner_id", "current-user"]]);
    else assert.deepEqual(calls.slice(1), [["from", "tenants"], ["select", "id"], ["eq", "owner_id", "current-user"], ["rpc", "get_notification_status_rows"]]);
    calls.length = 0;
    await assert.rejects(Page({ params: Promise.resolve({ locale: "de" }) }), /not-found/);
    assert.equal(calls.length, 0);
  }
});

test("owner page reports unavailable persistence without exposing query diagnostics", async () => {
  const builder = (result) => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit: async () => result, single: async () => result });
  const { default: Page } = await load("../app/[locale]/dashboard/notifications/page.tsx", {
    "next/navigation": { notFound() { throw new Error("not-found"); }, redirect(path) { throw new Error(`redirect:${path}`); } },
    "@/lib/i18n": { isLocale: () => true },
    "@/lib/auth": { async requireUser() { return { userId: "owner", supabase: { from() { return builder({ data: { id: "tenant" }, error: null }); }, async rpc() { return { data: null, error: new Error("private SQL diagnostic") }; } } }; } },
    "@/components/glowflow/notification-template-preview": { NotificationTemplatePreview: "preview" },
    "@/lib/notifications/status": { deriveNotificationStatus() { throw new Error("unused"); } },
  });
  const result = await Page({ params: Promise.resolve({ locale: "fr" }) });
  assert.equal(result.props.statusUnavailable, true);
  assert.ok(!JSON.stringify(result.props).includes("private SQL diagnostic"));
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

test("owner status rows are truthful, localized, and contain no send control", async () => {
  const { NotificationTemplatePreview } = await load("../components/glowflow/notification-template-preview.tsx", {
    react: { useState: (initial) => [initial, () => {}] },
    "next/link": ({ children }) => children,
    "@/lib/notifications/templates": { renderNotification() { return { locale: "en", text: "safe preview" }; } },
  });
  const html = renderToStaticMarkup(NotificationTemplatePreview({ locale: "en", records: [{ id: "row", kind: "confirmation", channel: "email", scheduledFor: "2030-06-15T12:00:00Z", status: "awaiting_consent", attemptCount: 0 }] }));
  assert.ok(html.includes("No recorded consent"));
  assert.ok(html.includes("Sending disabled"));
  assert.ok(html.includes("Booking confirmation · EMAIL"));
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

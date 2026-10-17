import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
const source = await readFile(new URL("../app/[locale]/dashboard/page.tsx", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
async function render(locale, owner = true) {
  const queries = [];
  const supabase = { from(table) {
    const filters = [];
    const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, async single() {
      queries.push({ table, filters });
      return { data: table === "users" ? { full_name: "Actual User", tenant_id: "actual-tenant" } : { name: "Actual Salon", owner_id: owner ? "signed-in-user" : "another-user", currency: "USD", country_code: "US", time_zone: "America/New_York" } };
    } };
    return query;
  } };
  const dependencies = {
    "next/link": "a",
    "next/navigation": { notFound() { throw new Error("not-found"); } },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/lib/auth": { requireUser: async () => ({ userId: "signed-in-user", supabase }) },
    "@/lib/i18n": { isLocale: value => ["fr", "en", "es"].includes(value) },
    "../auth-actions": { signOut: () => {} },
  };
  const loaded = { exports: {} };
  new Function("require", "exports", js)(name => dependencies[name] ?? require(name), loaded.exports);
  const html = renderToStaticMarkup(await loaded.exports.default({ params: Promise.resolve({ locale }) }));
  return { html, queries };
}

test("signed-in dashboard shows actual salon identity and working localized destinations without demo records", async () => {
  for (const locale of ["fr", "en", "es"]) {
    const { html, queries } = await render(locale);
    assert.match(html, /Actual User/);
    assert.match(html, /Actual Salon/);
    assert.match(html, /America\/New_York/);
    assert.doesNotMatch(html, /Sofia|Nadia|Maya|1248|312|Mar\. 8|allerg/i);
    for (const route of ["calendar", "walk-ins", "services", "products", "availability", "public-profile", "payments", "notifications"]) assert.ok(html.includes(`href="/${locale}/dashboard/${route}"`));
    assert.ok(html.includes({ fr: "Aperçu des notifications", en: "Notification preview", es: "Vista previa de notificaciones" }[locale]));
    assert.deepEqual(queries, [{ table: "users", filters: [["id", "signed-in-user"]] }, { table: "tenants", filters: [["id", "actual-tenant"]] }]);
  }
});

test("staff dashboard offers team work and hides owner-only settings", async () => {
  for (const locale of ["fr", "en", "es"]) {
    const { html } = await render(locale, false);
    assert.ok(html.includes(`href="/${locale}/dashboard/calendar"`));
    assert.ok(html.includes(`href="/${locale}/dashboard/walk-ins"`));
    for (const route of ["services", "products", "availability", "public-profile", "payments", "notifications"]) assert.ok(!html.includes(`/dashboard/${route}`));
  }
});

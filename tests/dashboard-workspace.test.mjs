import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const source = await readFile(new URL("app/[locale]/dashboard/page.tsx", root), "utf8");
const shellSource = await readFile(new URL("components/glowflow/workspace-shell.tsx", root), "utf8");

function load(input, dependencies) {
  const js = ts.transpileModule(input, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", js)(name => dependencies[name] ?? require(name), loaded.exports);
  return loaded.exports;
}

function fakeSupabase(owner) {
  const queries = [];
  const supabase = { from(table) {
    const filters = [];
    const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, async single() {
      queries.push({ table, filters });
      return { data: table === "users"
        ? { full_name: "Actual User", tenant_id: "actual-tenant", role: owner ? "owner" : "staff" }
        : { name: "Actual Salon", owner_id: owner ? "signed-in-user" : "another-user", currency: "USD", country_code: "US", time_zone: "America/New_York" } };
    } };
    return query;
  } };
  return { supabase, queries };
}

async function renderToday(locale, owner = true) {
  const { supabase, queries } = fakeSupabase(owner);
  const dependencies = {
    "next/link": "a",
    "next/navigation": { notFound() { throw new Error("not-found"); } },
    "@/components/glowflow/workspace-shell": { WorkspaceShell: ({ children }) => children },
    "@/lib/auth": { requireUser: async () => ({ userId: "signed-in-user", supabase }) },
    "@/lib/i18n": { isLocale: value => ["fr", "en", "es"].includes(value) },
    "@/lib/staff-invitations": { staffInvitationManagementEnabled: () => false },
  };
  const page = load(source, dependencies);
  return { html: renderToStaticMarkup(await page.default({ params: Promise.resolve({ locale }) })), queries };
}

async function renderShell(locale, active, owner = true, invitations = false) {
  const { supabase, queries } = fakeSupabase(owner);
  const dependencies = {
    "next/link": "a",
    "next/navigation": { notFound() { throw new Error("not-found"); } },
    "@/app/[locale]/auth-actions": { signOut: () => {} },
    "@/components/glowflow/brand-logo": { BrandLogo: () => null },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/lib/auth": { requireUser: async () => ({ userId: "signed-in-user", supabase }) },
    "@/lib/staff-invitations": { staffInvitationManagementEnabled: () => invitations },
  };
  const shell = load(shellSource, dependencies);
  return { html: renderToStaticMarkup(await shell.WorkspaceShell({ locale, active, children: "CONTENT" })), queries };
}

test("signed-in Today uses real tenant identity without demo records", async () => {
  for (const locale of ["fr", "en", "es"]) {
    const { html, queries } = await renderToday(locale);
    assert.match(html, /Actual/);
    assert.match(html, /America\/New_York/);
    assert.match(html, /font-display/);
    assert.doesNotMatch(html, /Sofia|Nadia|Maya|1248|312|Mar\. 8|allerg/i);
    for (const route of ["calendar", "clients", "walk-ins"]) assert.ok(html.includes(`href="/${locale}/dashboard/${route}"`));
    assert.deepEqual(queries, [{ table: "users", filters: [["id", "signed-in-user"]] }, { table: "tenants", filters: [["id", "actual-tenant"]] }]);
  }
});

test("shared workspace navigation localizes labels and marks each selected route", async () => {
  for (const locale of ["fr", "en", "es"]) {
    for (const [route, href] of [["today", `/${locale}/dashboard`], ["calendar", `/${locale}/dashboard/calendar`], ["clients", `/${locale}/dashboard/clients`]]) {
      const { html, queries } = await renderShell(locale, route);
      assert.match(html, /Actual Salon/);
      assert.match(html, /Actual User/);
      assert.match(html, /aria-current="page"/);
      assert.ok(html.includes(`href="${href}" aria-current="page"`));
      assert.ok(html.includes(`href="/${locale}/dashboard/notifications"`));
      assert.deepEqual(queries, [{ table: "users", filters: [["id", "signed-in-user"]] }, { table: "tenants", filters: [["id", "actual-tenant"]] }]);
    }
  }
});

test("staff navigation hides owner-only routes and invitations remain gated", async () => {
  for (const locale of ["fr", "en", "es"]) {
    const staff = (await renderShell(locale, "clients", false, true)).html;
    for (const route of ["calendar", "clients", "walk-ins", "notifications"]) assert.ok(staff.includes(`href="/${locale}/dashboard/${route}"`));
    for (const route of ["services", "products", "availability", "public-profile", "payments", "team/invitations"]) assert.ok(!staff.includes(`/dashboard/${route}`));
  }
  const owner = (await renderShell("en", "today", true, true)).html;
  assert.ok(owner.includes('href="/en/dashboard/team/invitations"'));
});

test("Today, Calendar, client list, and client detail share the shell without moving action routes", async () => {
  for (const [path, active] of [
    ["app/[locale]/dashboard/page.tsx", "today"],
    ["app/[locale]/dashboard/calendar/page.tsx", "calendar"],
    ["app/[locale]/dashboard/clients/page.tsx", "clients"],
    ["app/[locale]/dashboard/clients/[id]/page.tsx", "clients"],
  ]) {
    const pageSource = await readFile(new URL(path, root), "utf8");
    assert.match(pageSource, new RegExp(`<WorkspaceShell locale=\\{locale\\} active="${active}"`));
  }
});

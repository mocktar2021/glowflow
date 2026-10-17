import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const search = await import("../lib/salon-search.ts");
const markets = await import("../lib/markets.ts");
const migration = await readFile(new URL("../supabase/migrations/20261017220612_add_public_salon_sorting.sql", import.meta.url), "utf8");
const rollback = await readFile(new URL("../supabase/rollbacks/20261017220612_drop_public_salon_sorting.sql", import.meta.url), "utf8");

async function loadPage(rpc) {
  const source = await readFile(new URL("../app/[locale]/salons/(search)/page.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  const dependencies = {
    "next/link": "a",
    "next/headers": { cookies: async () => ({ get: () => ({ value: "en" }) }) },
    "next/navigation": { notFound() { throw new Error("not-found"); } },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/components/glowflow/marketplace-salon-card": { MarketplaceSalonCard: ({ salon }) => React.createElement("article", null, salon.business_name) },
    "@/lib/i18n": { isLocale: value => ["fr", "en", "es"].includes(value), salonProfileLocale: (_country, visitor, fallback) => visitor ?? fallback },
    "@/lib/markets": markets,
    "@/lib/marketplace-locations": { marketplaceLocationHref: (locale, country) => `/${locale}/salons/locations/${country}`, marketplaceLocation: () => null },
    "@/lib/salon-search": search,
    "@/lib/supabase/server": { createClient: async () => ({ rpc }) },
  };
  new Function("require", "exports", "process", js)(name => dependencies[name] ?? require(name), loaded.exports, { env: { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture" } });
  return loaded.exports.default;
}

test("sort values are allowlisted and default to relevance", () => {
  for (const value of search.salonSortValues) assert.equal(search.salonSearchSort(value), value);
  for (const value of ["", "distance", "price; drop table", "PRICE_ASC"]) assert.equal(search.salonSearchSort(value), "relevance");
});

test("sorted public RPC keeps RLS, explicit fields and stable sorting before pagination", () => {
  assert.match(migration, /create function public\.search_public_salons_sorted\(\s*sort_by text/);
  assert.match(migration, /security invoker/);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /where profile\.is_published = true/);
  assert.match(migration, /market\.status = 'active'/);
  assert.match(migration, /service\.is_active = true/);
  assert.match(migration, /matching_service\.is_active = true/);
  assert.match(migration, /case when sort_by = 'price_asc' and filter_country_code is not null\s+then matching\.starting_price end asc nulls last/);
  assert.match(migration, /case when sort_by = 'price_desc' and filter_country_code is not null\s+then matching\.starting_price end desc nulls last/);
  assert.match(migration, /case when sort_by = 'availability' then matching\.next_available_at end asc nulls last/);
  assert.match(migration, /sort_by in \('price_asc', 'price_desc'\) and filter_country_code is null/);
  assert.match(migration, /matching\.business_name,\s*matching\.slug\s*limit least\(greatest\(coalesce\(page_size, 12\), 1\), 48\)/);
  assert.match(migration, /grant execute on function public\.search_public_salons_sorted\([\s\S]*to anon, authenticated/);
  assert.match(rollback, /drop function if exists public\.search_public_salons_sorted\(/);
  assert.doesNotMatch(rollback, /drop table|search_public_salons\(/);
});

test("sort control sends the server-side mode and preserves it across pages", async () => {
  const calls = [];
  const result = { slug: "example-salon", business_name: "Example Salon", country_code: "US", city: "Greensboro", total_count: 20 };
  const Page = await loadPage(async (name, args) => { calls.push({ name, args }); return { data: [result], error: null }; });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ sort: "price_asc", country: "US", page: "2" }) }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "search_public_salons_sorted");
  assert.equal(calls[0].args.sort_by, "price_asc");
  assert.equal(calls[0].args.filter_country_code, "US");
  assert.equal(calls[0].args.page_offset, 9);
  assert.match(html, /name="sort"/);
  assert.match(html, /href="\/en\/salons\?sort=price_asc&amp;country=US"/);
  assert.match(html, /href="\/en\/salons\?sort=price_asc&amp;country=US&amp;page=3"/);
});

test("default relevance keeps the existing RPC and unknown modes cannot reach SQL", async () => {
  const calls = [];
  const Page = await loadPage(async (name, args) => { calls.push({ name, args }); return { data: [], error: null }; });
  await Page({ params: Promise.resolve({ locale: "fr" }), searchParams: Promise.resolve({ sort: "distance" }) });
  assert.equal(calls[0].name, "search_public_salons");
  assert.equal("sort_by" in calls[0].args, false);
});

test("price comparison requires a country and visibly falls back to relevance", async () => {
  const calls = [];
  const Page = await loadPage(async (name, args) => { calls.push({ name, args }); return { data: [], error: null }; });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ sort: "price_asc" }) }));
  assert.equal(calls[0].name, "search_public_salons");
  assert.equal("sort_by" in calls[0].args, false);
  assert.match(html, /Choose a country to compare prices in one currency/);
});

test("sort controls render in every supported language", async () => {
  const Page = await loadPage(async () => ({ data: [], error: null }));
  for (const [locale, label] of [["fr", "Trier par"], ["en", "Sort by"], ["es", "Ordenar por"]]) {
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ sort: "price_desc" }) }));
    assert.ok(html.includes(label));
    assert.match(html, /<option value="price_desc" selected="">/);
  }
});

test("missing sorted RPC falls back visibly without breaking discovery", async () => {
  const calls = [];
  const Page = await loadPage(async (name) => {
    calls.push(name);
    return name === "search_public_salons_sorted"
      ? { data: null, error: { code: "PGRST202" } }
      : { data: [], error: null };
  });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "es" }), searchParams: Promise.resolve({ sort: "availability" }) }));
  assert.deepEqual(calls, ["search_public_salons_sorted", "search_public_salons"]);
  assert.match(html, /La ordenación no está disponible temporalmente/);
});

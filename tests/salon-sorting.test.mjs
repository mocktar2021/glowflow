import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const search = await import("../lib/salon-search.ts");
const timeZones = await import("../lib/marketplace-time-zones.ts");
const markets = await import("../lib/markets.ts");
const migration = await readFile(new URL("../supabase/migrations/20261017220612_add_public_salon_sorting.sql", import.meta.url), "utf8");
const rollback = await readFile(new URL("../supabase/rollbacks/20261017220612_drop_public_salon_sorting.sql", import.meta.url), "utf8");

async function loadPage(rpc, configured = true, captureDistanceProps) {
  const source = await readFile(new URL("../app/[locale]/salons/(search)/page.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  const dependencies = {
    "next/link": "a",
    "next/headers": { cookies: async () => ({ get: () => ({ value: "en" }) }) },
    "next/navigation": { notFound() { throw new Error("not-found"); } },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/components/glowflow/distance-search": { DistanceSearch: ({ children, ...props }) => { captureDistanceProps?.(props); return children; } },
    "@/components/glowflow/marketplace-salon-card": { MarketplaceSalonCard: ({ salon }) => React.createElement("article", null, salon.business_name) },
    "@/components/glowflow/visitor-time-zone-field": { VisitorTimeZoneField: ({ initialZone, label, help, detectBrowserZone }) => React.createElement("div", { "data-zone": initialZone, "data-detect": detectBrowserZone }, label, help) },
    "@/lib/i18n": { isLocale: value => ["fr", "en", "es"].includes(value), salonProfileLocale: (_country, visitor, fallback) => visitor ?? fallback },
    "@/lib/marketplace-time-zones": timeZones,
    "@/lib/markets": markets,
    "@/lib/marketplace-locations": { marketplaceLocationHref: (locale, country) => `/${locale}/salons/locations/${country}`, marketplaceLocation: () => null },
    "@/lib/salon-search": search,
    "@/lib/salon-time-zones": { publicSalonTimeZones: async () => ({}) },
    "@/lib/supabase/server": { createClient: async () => ({ rpc }) },
  };
  new Function("require", "exports", "process", js)(name => dependencies[name] ?? require(name), loaded.exports, { env: configured ? { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture" } : {} });
  return loaded.exports.default;
}

async function loadTimeZoneField() {
  const source = await readFile(new URL("../components/glowflow/visitor-time-zone-field.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", js)(name => name === "@/lib/marketplace-time-zones" ? timeZones : require(name), loaded.exports);
  return loaded.exports.VisitorTimeZoneField;
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

test("maximum price uses selected country's minor units and warns without a country", async () => {
  const calls = [];
  const Page = await loadPage(async (name, args) => { calls.push({ name, args }); return { data: [], error: null }; });
  await Page({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ country: "US", maxPrice: "45.50" }) });
  assert.equal(calls[0].args.maximum_price, 4550);
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ maxPrice: "45" }) }));
  assert.equal(calls[1].args.maximum_price, null);
  assert.match(html, /Choose a country to filter prices in its currency/);
});

test("active advanced filters remain visible when opening a filtered search link", async () => {
  const Page = await loadPage(async () => ({ data: [], error: null }));

  for (const filters of [
    { postcode: "27405" },
    { category: "hair" },
    { maxPrice: "45" },
    { availableBefore: "2026-11-15" },
  ]) {
    const html = renderToStaticMarkup(await Page({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve(filters),
    }));
    assert.match(html, /<details open=""/);
  }

  const unfiltered = renderToStaticMarkup(await Page({
    params: Promise.resolve({ locale: "en" }),
    searchParams: Promise.resolve({ q: "braids" }),
  }));
  assert.match(unfiltered, /<details class=/);
  assert.doesNotMatch(unfiltered, /<details open=""/);
});

test("advanced search controls retain a visible keyboard focus outline in every locale", async () => {
  const Page = await loadPage(async () => ({ data: [], error: null }));
  const TimeZoneField = await loadTimeZoneField();

  function assertVisibleFocus(control, context) {
    assert.ok(control, `${context} control is present`);
    assert.match(control, /focus-visible:outline-solid/);
    assert.match(control, /focus-visible:outline-2/);
    assert.match(control, /focus-visible:outline-offset-2/);
    assert.match(control, /focus-visible:outline-\[#b77a42\]/);
  }

  for (const locale of ["fr", "en", "es"]) {
    const html = renderToStaticMarkup(await Page({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({}),
    }));
    for (const [tag, name] of [["input", "postcode"], ["select", "category"], ["input", "maxPrice"], ["input", "availableBefore"]]) {
      const control = html.match(new RegExp(`<${tag}\\b[^>]*\\bname="${name}"[^>]*>`))?.[0];
      assertVisibleFocus(control, `${locale}: ${name}`);
    }
    const timeZoneHtml = renderToStaticMarkup(React.createElement(TimeZoneField, {
      initialZone: "UTC", detectBrowserZone: false, options: ["UTC"], label: "Time zone", help: "Filter time zone",
    }));
    const timeZoneControl = timeZoneHtml.match(/<select\b[^>]*\bname="timeZone"[^>]*>/)?.[0];
    assertVisibleFocus(timeZoneControl, `${locale}: timeZone`);
  }
});

test("search actions and server pagination have visible keyboard focus in every locale", async () => {
  const result = { slug: "example-salon", business_name: "Example Salon", country_code: "US", city: "Greensboro", total_count: 20 };
  const Page = await loadPage(async () => ({ data: [result], error: null }));

  for (const locale of ["fr", "en", "es"]) {
    const html = renderToStaticMarkup(await Page({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({ page: "2" }),
    }));
    const submit = html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0];
    const form = html.match(/<form\b[\s\S]*?<\/form>/)?.[0];
    assert.ok(form, `${locale}: search form is present`);
    const formLinks = [...form.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
    const pagination = html.match(/<nav class="mt-8[^>]*>[\s\S]*?<\/nav>/)?.[0];
    assert.ok(pagination, `${locale}: pagination is present`);
    const pageLinks = [...pagination.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
    const reset = formLinks.find((link) => link.includes(`href="/${locale}/salons"`));
    const previous = pageLinks.find((link) => link.includes(`href="/${locale}/salons"`));
    const next = pageLinks.find((link) => link.includes(`href="/${locale}/salons?page=3"`));

    for (const [name, control] of [["submit", submit], ["reset", reset], ["previous", previous], ["next", next]]) {
      assert.ok(control, `${locale}: ${name} control is present`);
      assert.match(control, /focus-visible:outline-solid/);
      assert.match(control, /focus-visible:outline-2/);
      assert.match(control, /focus-visible:outline-offset-2/);
      assert.match(control, /dark:focus-visible:outline-\[#efc992\]/);
    }
    assert.match(previous, /min-h-11/);
    assert.match(next, /min-h-11/);
  }
});

test("shared country links normalize supported codes and ignore unsupported codes visibly", async () => {
  const calls = [];
  const result = { slug: "example-salon", business_name: "Example Salon", country_code: "US", city: "Greensboro", total_count: 20 };
  const Page = await loadPage(async (_name, args) => { calls.push(args); return { data: [result], error: null }; });

  const supported = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ country: " us " }) }));
  assert.equal(calls[0].filter_country_code, "US");
  assert.match(supported, /<option value="US" selected="">/);
  assert.match(supported, /href="\/en\/salons\?country=US&amp;page=2"/);

  for (const [locale, notice] of [
    ["fr", "Ce pays n’est pas disponible"],
    ["en", "That country is not available"],
    ["es", "Ese país no está disponible"],
  ]) {
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ country: "ZZ" }) }));
    assert.equal(calls.at(-1).filter_country_code, null);
    assert.match(html, new RegExp(notice));
    assert.match(html, new RegExp(`href="/${locale}/salons\\?page=2"`));
    assert.doesNotMatch(html, /country=ZZ/);
  }

  const priceHtml = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ country: "ZZ", sort: "price_asc", maxPrice: "40" }) }));
  assert.equal(calls.at(-1).maximum_price, null);
  assert.match(priceHtml, /Choose a country to compare prices in one currency/);
  assert.match(priceHtml, /Choose a country to filter prices in its currency/);
});

test("invalid or out-of-range pages show first-page results instead of an empty state", async () => {
  const calls = [];
  const result = { slug: "example-salon", business_name: "Example Salon", country_code: "US", city: "Greensboro", total_count: 1 };
  const Page = await loadPage(async (_name, args) => {
    calls.push(args.page_offset);
    return { data: args.page_offset === 0 ? [result] : [], error: null };
  });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ page: "2" }) }));
  assert.deepEqual(calls, [9, 0]);
  assert.match(html, /That page does not exist/);
  assert.match(html, /Example Salon/);
  calls.length = 0;
  await Page({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ page: "9999999999999999999999" }) });
  assert.deepEqual(calls, [0]);
});

test("missing Supabase configuration shows an error rather than an empty marketplace", async () => {
  const Page = await loadPage(async () => { throw new Error("should not query"); }, false);
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}) }));
  assert.match(html, /Search is unavailable/);
  assert.doesNotMatch(html, /The first salons are coming soon/);
});

test("available-by date is converted from the chosen visitor zone before the RPC and retained on pagination", async () => {
  const calls = [];
  const result = { slug: "example-salon", business_name: "Example Salon", country_code: "US", city: "Greensboro", total_count: 20 };
  const Page = await loadPage(async (name, args) => { calls.push({ name, args }); return { data: [result], error: null }; });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ availableBefore: "2026-03-08", timeZone: "America/New_York", page: "2" }) }));
  assert.equal(calls[0].args.available_before, "2026-03-09T03:59:59.999999Z");
  assert.match(html, /data-zone="America\/New_York" data-detect="false"/);
  assert.match(html, /availableBefore=2026-03-08&amp;timeZone=America%2FNew_York/);
  assert.match(html, /Times on salon cards use each salon/);
});

test("legacy date-only links retain UTC semantics without browser-zone detection", async () => {
  const calls = [];
  const Page = await loadPage(async (_name, args) => { calls.push(args); return { data: [], error: null }; });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "fr" }), searchParams: Promise.resolve({ availableBefore: "2026-11-15" }) }));
  assert.equal(calls[0].available_before, "2026-11-15T23:59:59.999999Z");
  assert.match(html, /data-zone="UTC" data-detect="false"/);
  const emptyHtml = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "fr" }), searchParams: Promise.resolve({}) }));
  assert.match(emptyHtml, /data-zone="UTC" data-detect="true"/);
});

test("invalid date and zone do not reach SQL as an invalid timestamp", async () => {
  const calls = [];
  const Page = await loadPage(async (_name, args) => { calls.push(args); return { data: [], error: null }; });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "es" }), searchParams: Promise.resolve({ availableBefore: "2026-02-30", timeZone: "Mars/Olympus" }) }));
  assert.equal(calls[0].available_before, null);
  assert.match(html, /No se reconoce esa zona horaria/);
  assert.match(html, /La fecha no es válida/);
  assert.match(html, /data-zone="UTC" data-detect="false"/);
});

test("production results section does not nest the distance live region inside a broad live section", async () => {
  const distanceProps = [];
  const Page = await loadPage(async () => ({ data: [], error: null }), true, props => distanceProps.push(props));
  const warningHtml = renderToStaticMarkup(await Page({
    params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ country: "ZZ", q: "unknown" }),
  }));
  const resultSection = warningHtml.match(/<section class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8"[^>]*>/);
  assert.ok(resultSection, "the production results section renders");
  assert.doesNotMatch(resultSection[0], /\b(?:aria-live|role)=/, "card changes must not be announced by an outer live region");
  assert.match(warningHtml, /<p role="status"[^>]*>That country is not available/, "individual warnings remain announced");
  assert.equal(distanceProps.at(-1).fallbackAnnouncement,
    "No salons match these filters. Change or clear the filters to broaden your search.",
    "the same scoped live region describes an empty filtered result");

  renderToStaticMarkup(await Page({
    params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}),
  }));
  assert.equal(distanceProps.at(-1).fallbackAnnouncement,
    "The first salons are coming soon. Salons will appear here only after their owner chooses to publish their profile.");

  const CountPage = await loadPage(async () => ({ data: [{ slug: "fixture", business_name: "Fixture", country_code: "US", city: "Fixture", total_count: 2 }], error: null }), true, props => distanceProps.push(props));
  renderToStaticMarkup(await CountPage({
    params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}),
  }));
  assert.equal(distanceProps.at(-1).fallbackAnnouncement, "2 salons found.",
    "ordinary results retain a concise count announcement");

  const UnavailablePage = await loadPage(async () => { throw new Error("should not query"); }, false);
  const errorHtml = renderToStaticMarkup(await UnavailablePage({
    params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}),
  }));
  assert.match(errorHtml, /<div role="status"[^>]*><h2[^>]*>Search is unavailable/, "the load error retains a scoped status");
});

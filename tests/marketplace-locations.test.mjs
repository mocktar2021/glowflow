import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const markets = await import("../lib/markets.ts");
const search = await import("../lib/salon-search.ts");

async function load(relativePath, dependencies = {}, env = process.env) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", "process", js)(name => dependencies[name] ?? require(name), loaded.exports, { env });
  return loaded.exports;
}

const locations = await load("../lib/marketplace-locations.ts", { "@/lib/markets": markets });
const locationPagePath = "../app/[locale]/salons/locations/[country]/[[...city]]/page.tsx";

test("country and city routes accept only supported, bounded location segments", () => {
  assert.equal(locations.marketplaceLocation("US").market.country_code, "US");
  assert.equal(locations.marketplaceLocation("US", []).market.country_code, "US");
  assert.equal(locations.marketplaceLocation("FR", ["Bry-sur-marne"]).city, "Bry-sur-marne");
  assert.equal(locations.marketplaceLocationHref("fr", "FR", "Saint-Étienne"), "/fr/salons/locations/FR/Saint-%C3%89tienne");
  for (const [country, city] of [["us"], ["ZZ"], ["US", ["<script>"]], ["US", ["one", "two"]], ["US", [" "]]]) {
    assert.equal(locations.marketplaceLocation(country, city), null);
  }
});

test("location metadata has localized headings, canonical URLs, and language alternates", async () => {
  const { generateMetadata } = await load(locationPagePath, {
    "next/link": "a",
    "next/headers": { cookies: async () => ({ get: () => undefined }) },
    "next/navigation": { notFound() { throw new Error("not-found"); } },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/components/glowflow/marketplace-salon-card": { MarketplaceSalonCard: () => null },
    "@/lib/i18n": { isLocale: value => ["fr", "en", "es"].includes(value) },
    "@/lib/marketplace-locations": locations,
    "@/lib/markets": markets,
    "@/lib/supabase/server": { createClient: async () => null },
  });
  for (const locale of ["fr", "en", "es"]) {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale, country: "US", city: ["Greensboro"] }), searchParams: Promise.resolve({}) });
    assert.ok(metadata.title.includes("Greensboro"));
    assert.equal(metadata.alternates.canonical, `/${locale}/salons/locations/US/Greensboro`);
    for (const language of ["fr", "en", "es"]) assert.equal(metadata.alternates.languages[language], `/${language}/salons/locations/US/Greensboro`);
  }
  const secondPage = await generateMetadata({ params: Promise.resolve({ locale: "en", country: "FR" }), searchParams: Promise.resolve({ page: "2" }) });
  assert.equal(secondPage.alternates.canonical, "/en/salons/locations/FR?page=2");
  assert.deepEqual(await generateMetadata({ params: Promise.resolve({ locale: "en", country: "ZZ" }), searchParams: Promise.resolve({}) }), { robots: { index: false, follow: false } });
});

test("location page uses the public search boundary and links to a salon without changing visitor preference", async () => {
  const calls = [];
  const results = [{ slug: "example-salon", business_name: "Example Salon", country_code: "US", city: "Greensboro", postal_code: "27405", categories: ["hair"], image_url: null, description_json: {}, next_available_at: null, starting_price: null, currency: "USD", total_count: 1 }];
  const { default: Page } = await load(locationPagePath, {
    "next/link": "a",
    "next/headers": { cookies: async () => ({ get: () => ({ value: "es" }) }) },
    "next/navigation": { notFound() { throw new Error("not-found"); } },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/components/glowflow/marketplace-salon-card": { MarketplaceSalonCard: ({ salon, href }) => React.createElement("a", { href }, salon.business_name) },
    "@/lib/i18n": { isLocale: value => ["fr", "en", "es"].includes(value), salonProfileLocale: (_country, visitor, fallback) => visitor ?? fallback },
    "@/lib/marketplace-locations": locations,
    "@/lib/markets": markets,
    "@/lib/supabase/server": { createClient: async () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: results, error: null }; } }) },
  }, { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture" });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en", country: "US", city: ["Greensboro"] }), searchParams: Promise.resolve({}) }));
  assert.deepEqual(calls, [{ name: "search_public_salons", args: { search_text: null, filter_country_code: "US", filter_city: "Greensboro", filter_postal_code: null, filter_category: null, maximum_price: null, available_before: null, page_size: 9, page_offset: 0 } }]);
  assert.match(html, /Beauty salons: Greensboro, United States/);
  assert.match(html, /href="\/en\/salons\?country=US&amp;city=Greensboro"/);
  assert.match(html, /href="\/es\/salons\/example-salon"/);
  assert.match(html, /https:\/\/schema\.org/);
  assert.match(html, /"@type":"CollectionPage"/);
  await assert.rejects(Page({ params: Promise.resolve({ locale: "en", country: "ZZ" }), searchParams: Promise.resolve({}) }), /not-found/);
  assert.equal(calls.length, 1);
});

test("country location uses its configured language when the visitor has no preference", async () => {
  const marketLookups = [];
  const { default: Page } = await load(locationPagePath, {
    "next/link": "a",
    "next/headers": { cookies: async () => ({ get: () => undefined }) },
    "next/navigation": { notFound() { throw new Error("not-found"); } },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/components/glowflow/marketplace-salon-card": { MarketplaceSalonCard: ({ salon, href }) => React.createElement("a", { href }, salon.business_name) },
    "@/lib/i18n": { isLocale: value => ["fr", "en", "es"].includes(value), salonProfileLocale: (country, visitor, fallback) => visitor ?? country ?? fallback },
    "@/lib/marketplace-locations": locations,
    "@/lib/markets": markets,
    "@/lib/supabase/server": { createClient: async () => ({
      rpc: async () => ({ data: [{ slug: "example-salon", business_name: "Example Salon", city: "Greensboro", total_count: 1 }], error: null }),
      from: table => {
        marketLookups.push(table);
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { default_locale: "fr" } }) }) }) };
      },
    }) },
  }, { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture" });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en", country: "US" }), searchParams: Promise.resolve({}) }));
  assert.match(html, /href="\/fr\/salons\/example-salon"/);
  assert.deepEqual(marketLookups, ["markets"]);
});

test("published cover image appears in result cards with an initials fallback", async () => {
  const { MarketplaceSalonCard } = await load("../components/glowflow/marketplace-salon-card.tsx", {
    "next/link": "a",
    "next/image": ({ src, alt }) => React.createElement("img", { src, alt }),
    "@/lib/markets": markets,
    "@/lib/salon-search": search,
  });
  const labels = { hair: "Hair", nails: "Nails", other: "Other", from: "From", price: "Price", priceUnavailable: "Price unavailable", next: "Next opening", availabilityUnknown: "See salon", book: "View and book" };
  const salon = { slug: "example-salon", business_name: "Example Salon", country_code: "US", city: "Greensboro", postal_code: "27405", categories: ["hair"], description_json: {}, next_available_at: null, starting_price: null, currency: "USD" };
  const props = { salon, locale: "en", href: "/en/salons/example-salon", cityHref: "/en/salons/locations/US/Greensboro", labels };
  const withCover = renderToStaticMarkup(React.createElement(MarketplaceSalonCard, { ...props, salon: { ...salon, image_url: "https://fixture.supabase.co/storage/v1/object/public/salon-public-media/cover.webp" } }));
  assert.match(withCover, /<img[^>]+alt=""/);
  assert.match(withCover, /href="\/en\/salons\/locations\/US\/Greensboro"/);
  assert.match(withCover, /Price unavailable/);
  const withoutCover = renderToStaticMarkup(React.createElement(MarketplaceSalonCard, { ...props, salon: { ...salon, image_url: null } }));
  assert.match(withoutCover, /<div[^>]*>ES<\/div>/);
  assert.equal(search.publicSalonImageUrl("https://example.com/photo.jpg"), null);
  assert.equal(search.publicSalonImageUrl("https://foo.supabase.co.evil.com/storage/v1/object/public/salon-public-media/photo.jpg"), null);
  assert.match(search.publicSalonImageUrl("https://fixture.supabase.co/storage/v1/object/public/salon-public-media/photo.jpg"), /fixture\.supabase\.co/);
});

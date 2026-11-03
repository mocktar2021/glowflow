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
    "@/lib/salon-time-zones": { publicSalonTimeZones: async () => ({}) },
    "@/lib/supabase/server": { createClient: async () => null },
  });
  for (const locale of ["fr", "en", "es"]) {
    for (const city of [undefined, ["Greensboro"]]) {
      const metadata = await generateMetadata({ params: Promise.resolve({ locale, country: "US", city }), searchParams: Promise.resolve({}) });
      const path = `/${locale}/salons/locations/US${city ? "/Greensboro" : ""}`;
      assert.equal(metadata.alternates.canonical, path);
      assert.equal(metadata.openGraph.url, `https://glowflow.mocktar.com${path}`);
      assert.deepEqual(metadata.openGraph.images, [{ url: "/og-glowflow.png", width: 1200, height: 630, alt: "GlowFlow" }]);
      if (city) assert.ok(metadata.title.includes("Greensboro"));
      for (const language of ["fr", "en", "es"]) assert.equal(metadata.alternates.languages[language], `/${language}/salons/locations/US${city ? "/Greensboro" : ""}`);
    }
  }
  const secondPage = await generateMetadata({ params: Promise.resolve({ locale: "en", country: "FR" }), searchParams: Promise.resolve({ page: "2" }) });
  assert.equal(secondPage.alternates.canonical, "/en/salons/locations/FR?page=2");
  assert.equal(secondPage.openGraph.url, "https://glowflow.mocktar.com/en/salons/locations/FR?page=2");
  assert.equal(secondPage.openGraph.images[0].url, "/og-glowflow.png");
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
    "@/lib/salon-time-zones": { publicSalonTimeZones: async () => ({}) },
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

test("empty country and city pages retain CollectionPage structured data without inventing salons", async () => {
  let searchError = null;
  const { default: Page } = await load(locationPagePath, {
    "next/link": "a",
    "next/headers": { cookies: async () => ({ get: () => undefined }) },
    "next/navigation": { notFound() { throw new Error("not-found"); } },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/components/glowflow/marketplace-salon-card": { MarketplaceSalonCard: () => null },
    "@/lib/i18n": { isLocale: value => ["fr", "en", "es"].includes(value) },
    "@/lib/marketplace-locations": locations,
    "@/lib/markets": markets,
    "@/lib/salon-time-zones": { publicSalonTimeZones: async () => ({}) },
    "@/lib/supabase/server": { createClient: async () => ({ rpc: async () => ({ data: [], error: searchError }) }) },
  }, { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture" });

  for (const city of [undefined, ["Greensboro"]]) {
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en", country: "US", city }), searchParams: Promise.resolve({}) }));
    const jsonLd = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
    assert.ok(jsonLd, "Empty location pages must retain structured data");
    const schema = JSON.parse(jsonLd);
    assert.equal(schema["@type"], "CollectionPage");
    assert.equal(schema.mainEntity["@type"], "ItemList");
    assert.deepEqual(schema.mainEntity.itemListElement, []);
    assert.equal(schema.about.address.addressCountry, "US");
    assert.equal(schema.about.address.addressLocality, city?.[0]);
  }

  searchError = { message: "unavailable" };
  const unavailable = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en", country: "US" }), searchParams: Promise.resolve({}) }));
  assert.doesNotMatch(unavailable, /application\/ld\+json/);
});

test("stale country and city result pages return to the first page, but search errors do not", async () => {
  const calls = [];
  let response = { data: [], error: null };
  const { default: Page } = await load(locationPagePath, {
    "next/link": "a",
    "next/headers": { cookies: async () => ({ get: () => undefined }) },
    "next/navigation": {
      notFound() { throw new Error("not-found"); },
      redirect(href) { throw new Error(`redirect:${href}`); },
    },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/components/glowflow/marketplace-salon-card": { MarketplaceSalonCard: () => null },
    "@/lib/i18n": { isLocale: value => ["fr", "en", "es"].includes(value) },
    "@/lib/marketplace-locations": locations,
    "@/lib/markets": markets,
    "@/lib/salon-time-zones": { publicSalonTimeZones: async () => ({}) },
    "@/lib/supabase/server": { createClient: async () => ({ rpc: async (_name, args) => { calls.push(args); return response; } }) },
  }, { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture" });

  for (const [locale, city, href] of [
    ["fr", undefined, "/fr/salons/locations/US"],
    ["en", ["Greensboro"], "/en/salons/locations/US/Greensboro"],
    ["es", ["Greensboro"], "/es/salons/locations/US/Greensboro"],
  ]) {
    await assert.rejects(Page({ params: Promise.resolve({ locale, country: "US", city }), searchParams: Promise.resolve({ page: "2" }) }), new RegExp(`redirect:${href}$`));
  }
  assert.deepEqual(calls.map(({ page_offset }) => page_offset), [9, 9, 9]);

  const firstPage = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en", country: "US" }), searchParams: Promise.resolve({ page: "1" }) }));
  assert.match(firstPage, /No salons are published here yet/);

  response = { data: null, error: { message: "temporary failure" } };
  const failedPage = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale: "en", country: "US" }), searchParams: Promise.resolve({ page: "2" }) }));
  assert.match(failedPage, /Search is temporarily unavailable/);
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
    "@/lib/salon-time-zones": { publicSalonTimeZones: async () => ({}) },
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

test("location navigation and result announcements are accessible in every locale", async () => {
  const salon = { slug: "example-salon", business_name: "Example Salon", country_code: "US", city: "Greensboro", postal_code: "27405", categories: ["hair"], image_url: null, description_json: {}, next_available_at: null, starting_price: null, currency: "USD", total_count: 20 };
  let response = { data: [salon], error: null };
  const { default: Page } = await load(locationPagePath, {
    "next/link": "a",
    "next/headers": { cookies: async () => ({ get: () => ({ value: "en" }) }) },
    "next/navigation": { notFound() { throw new Error("not-found"); } },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/components/glowflow/marketplace-salon-card": { MarketplaceSalonCard: () => null },
    "@/lib/i18n": { isLocale: value => ["fr", "en", "es"].includes(value), salonProfileLocale: (_country, visitor, fallback) => visitor ?? fallback },
    "@/lib/marketplace-locations": locations,
    "@/lib/markets": markets,
    "@/lib/salon-time-zones": { publicSalonTimeZones: async () => ({}) },
    "@/lib/supabase/server": { createClient: async () => ({ rpc: async () => response }) },
  }, { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture" });
  const expected = {
    fr: { skipResults: "Aller aux résultats", results: "salons trouvés", empty: "Aucun salon publié ici pour le moment.", unavailable: "La recherche est momentanément indisponible." },
    en: { skipResults: "Skip to results", results: "salons found", empty: "No salons are published here yet.", unavailable: "Search is temporarily unavailable." },
    es: { skipResults: "Ir a los resultados", results: "salones encontrados", empty: "Todavía no hay salones publicados aquí.", unavailable: "La búsqueda no está disponible temporalmente." },
  };

  for (const locale of ["fr", "en", "es"]) {
    response = { data: [salon], error: null };
    for (const city of [undefined, ["Greensboro"]]) {
      const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale, country: "US", city }), searchParams: Promise.resolve({ page: "2" }) }));
      assert.match(html, /<a href="#location-results"[^>]*class="[^"]*sr-only[^"]*focus:not-sr-only/);
      assert.ok(html.includes(`>${expected[locale].skipResults}</a>`), "Skip link is localized");
      assert.match(html, /<section[^>]*id="location-results"[^>]*tabindex="-1"/);
      const navs = [...html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)].map(match => match[0]);
      assert.equal(navs.length, 2, "Breadcrumb and pagination remain separate landmarks");
      const breadcrumbLinks = [...navs[0].matchAll(/<a\b[^>]*>/g)].map(match => match[0]);
      const paginationLinks = [...navs[1].matchAll(/<a\b[^>]*>/g)].map(match => match[0]);
      assert.equal(breadcrumbLinks.length, city ? 2 : 1);
      assert.equal(paginationLinks.length, 2, "Middle page has previous and next targets");
      for (const link of [...breadcrumbLinks, ...paginationLinks]) {
        assert.match(link, /min-h-11/, "Navigation targets are at least 44px high");
        assert.match(link, /focus-visible:outline-2/, "Keyboard focus is visible");
        assert.match(link, /focus-visible:outline-offset-2/);
        assert.match(link, /dark:focus-visible:outline-/);
      }
      assert.doesNotMatch(html, /<section[^>]*aria-live=/, "The result-card grid must not be a live region");
      assert.equal(html.match(/<p role="status"[^>]*>([^<]+)<\/p>/)?.[1], "20 " + expected[locale].results);
    }

    response = { data: [], error: null };
    const empty = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale, country: "US" }), searchParams: Promise.resolve({}) }));
    assert.equal(empty.match(/<p role="status"[^>]*>([^<]+)<\/p>/)?.[1], expected[locale].empty);

    response = { data: null, error: { message: "unavailable" } };
    const unavailable = renderToStaticMarkup(await Page({ params: Promise.resolve({ locale, country: "US" }), searchParams: Promise.resolve({}) }));
    assert.equal(unavailable.match(/<p role="status"[^>]*>([^<]+)<\/p>/)?.[1], expected[locale].unavailable);
  }
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
  assert.match(withoutCover, /<div[^>]*aria-hidden="true"[^>]*>ES<\/div>/, "decorative initials should not be announced before the salon name");
  const localTime = renderToStaticMarkup(React.createElement(MarketplaceSalonCard, { ...props, timeZone: "America/Los_Angeles", salon: { ...salon, image_url: null, next_available_at: "2026-11-15T14:00:00Z" } }));
  assert.match(localTime, /6:00 AM/);
  assert.match(localTime, /America\/Los_Angeles/);
  const utcTime = renderToStaticMarkup(React.createElement(MarketplaceSalonCard, { ...props, salon: { ...salon, image_url: null, next_available_at: "2026-11-15T14:00:00Z" } }));
  assert.match(utcTime, /UTC/);
  assert.equal(search.publicSalonImageUrl("https://example.com/photo.jpg"), null);
  assert.equal(search.publicSalonImageUrl("https://foo.supabase.co.evil.com/storage/v1/object/public/salon-public-media/photo.jpg"), null);
  assert.match(search.publicSalonImageUrl("https://fixture.supabase.co/storage/v1/object/public/salon-public-media/photo.jpg"), /fixture\.supabase\.co/);
});

test("localized result-card booking links identify their salon to assistive technology", async () => {
  const { MarketplaceSalonCard } = await load("../components/glowflow/marketplace-salon-card.tsx", {
    "next/link": "a",
    "next/image": ({ src, alt }) => React.createElement("img", { src, alt }),
    "@/lib/markets": markets,
    "@/lib/salon-search": search,
  });
  const salon = {
    slug: "first-salon", business_name: "First Salon", country_code: "US", city: "Greensboro",
    postal_code: "27405", categories: [], description_json: {}, image_url: null,
    next_available_at: null, starting_price: null, currency: "USD",
  };
  const labels = {
    hair: "Hair", nails: "Nails", other: "Other", from: "From", price: "Price",
    priceUnavailable: "Price unavailable", next: "Next opening", availabilityUnknown: "See salon",
  };
  for (const [locale, book] of [["fr", "Voir et réserver"], ["en", "View and book"], ["es", "Ver y reservar"]]) {
    const first = renderToStaticMarkup(React.createElement(MarketplaceSalonCard, {
      salon, locale, href: `/${locale}/salons/first-salon`, labels: { ...labels, book },
    }));
    const second = renderToStaticMarkup(React.createElement(MarketplaceSalonCard, {
      salon: { ...salon, slug: "second-salon", business_name: "Second Salon" },
      locale, href: `/${locale}/salons/second-salon`, labels: { ...labels, book },
    }));
    assert.match(first, new RegExp(`aria-label="${book}: First Salon"`));
    assert.match(second, new RegExp(`aria-label="${book}: Second Salon"`));
    assert.match(first, new RegExp(`>${book}<\\/a>`), "visible link text stays unchanged");
  }
});

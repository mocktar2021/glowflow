import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { localizedProductText, productDefaultLocale } from "../lib/product-localization.ts";
import { selectPublishedPolicy } from "../lib/published-policy.ts";
const require = createRequire(import.meta.url);
async function load(file, dependencies = {}) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", js)((name) => dependencies[name] ?? require(name), loaded.exports);
  return loaded.exports;
}
const marketConfig = await load("../lib/markets.ts");
const first = "11111111-1111-4111-8111-111111111111";
const chosen = "22222222-2222-4222-8222-222222222222";
const foreign = "33333333-3333-4333-8333-333333333333";
const inactive = "44444444-4444-4444-8444-444444444444";
const tenant = { id: "salon-a", slug: "salon-a", name: "Salon A", city: "Madrid", country_code: "ES", currency: "EUR", time_zone: "Europe/Madrid", is_booking_enabled: true };
const service = (id, tenant_id = tenant.id, is_active = true) => ({ id, tenant_id, is_active, title_json: { fr: `Prestation ${id}`, en: `Service ${id}`, es: `Servicio ${id}` }, duration_minutes: 30, price: id === chosen ? 4200 : 2500, deposit_amount: 500, currency: "EUR" });
const catalog = [service(first), service(chosen), service(foreign, "salon-b"), service(inactive, tenant.id, false)];
const profile = { tenant_id: tenant.id, slug: tenant.slug, business_name: tenant.name, is_published: true, description_json: {}, country_code: "ES", city: tenant.city, categories: [], gallery_urls: [], opening_hours: {}, team_json: [], policies_json: {}, payment_methods: [] };
function database({ profilePublished = true, profileCountry = tenant.country_code, tenantCurrency = tenant.currency, marketDefaultLocale = "es", products = [], policies = {}, services = catalog } = {}) {
  const queries = [];
  return { queries, from(table) {
    let filters = [];
    const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, order() { return result(false); }, single() { return result(true); }, maybeSingle() { return result(true); } };
    function result(single) {
      queries.push({ table, filters });
      const profiles = [{ ...profile, country_code: profileCountry, is_published: profilePublished, policies_json: policies }];
      const rows = (table === "tenants" ? [{ ...tenant, currency: tenantCurrency }] : table === "services" ? services : table === "markets" ? [{ country_code: "ES", default_locale: marketDefaultLocale }] : table === "salon_products" ? products : profiles).filter(row => filters.every(([key, value]) => row[key] === value));
      return Promise.resolve({ data: single ? rows[0] ?? null : rows });
    }
    return query;
  } };
}
async function withConfiguration(fn) {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"];
  const previous = keys.map(key => process.env[key]);
  keys.forEach(key => process.env[key] = "fixture");
  try { await fn(); } finally { keys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]); }
}
async function booking(db, { sandbox = false, owner = true } = {}) {
  const bookingStaff = await load("../lib/public-booking-staff.ts");
  return (await load("../app/[locale]/book/[slug]/page.tsx", {
    "next/navigation": { notFound() { throw new Error("not-found"); } },
    "@/lib/i18n": { isLocale: locale => ["fr", "en", "es"].includes(locale) },
    "@/lib/public-booking-v2-config": { publicBookingV2Mode: () => "off" },
    "@/lib/public-booking-staff": bookingStaff,
    "@/components/glowflow/booking-flow": { BookingFlow: "demo" },
    "@/components/glowflow/live-booking-flow": { LiveBookingFlow: "live" },
    "@/components/glowflow/sandbox-payment-status": { SandboxPaymentStatusPanel: "status" },
    "@/lib/stripe-deposits-config": { sandboxDepositConfiguration: () => sandbox },
    "@/lib/stripe-sandbox": { sandboxOwner: async () => owner ? { tenant, supabase: db } : null },
    "@/lib/supabase/admin": { createAdminClient: () => db },
  })).default;
}
const request = (locale, service, extra = {}) => ({ params: Promise.resolve({ locale, slug: tenant.slug }), searchParams: Promise.resolve({ ...(service === undefined ? {} : { service }), ...extra }) });
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
test("localized profile service links carry only active services for this salon", async () => withConfiguration(async () => {
  const db = database({ tenantCurrency: "USD" });
  const markets = await load("../lib/markets.ts");
  const { default: Page } = await load("../app/[locale]/salons/[slug]/page.tsx", {
    "@/lib/supabase/server": { createClient: async () => db },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/lib/i18n": { isLocale: locale => ["fr", "en", "es"].includes(locale) },
    "@/lib/markets": markets,
    "@/lib/product-localization": { localizedProductText, productDefaultLocale },
    "@/lib/published-policy": { selectPublishedPolicy },
  });
  for (const [locale, label] of [["fr", "Réserver cette prestation"], ["en", "Book this service"], ["es", "Reservar este servicio"]]) {
    const tree = await Page({ params: Promise.resolve({ locale, slug: tenant.slug }) });
    const links = nodes(tree).filter(node => node.props?.href?.includes("?service="));
    assert.deepEqual(links.map(link => link.props.href), [first, chosen].map(id => `/${locale}/book/${tenant.slug}?service=${id}`));
    assert.equal(links[1].props.children, label);
    assert.ok(links[1].props["aria-label"].includes(catalog[1].title_json[locale]));
    assert.ok(nodes(tree).some(node => node.type === "strong" && node.props.children === markets.formatMinorMoneyWithCurrencyPrecision(4200, "EUR", locale)));
    assert.ok(nodes(tree).some(node => node.type === "span" && Array.isArray(node.props.children) && node.props.children.includes(markets.formatMinorMoneyWithCurrencyPrecision(500, "EUR", locale))));
  }
}));
test("published product text follows selection and falls back to the salon country language", async () => withConfiguration(async () => {
  const db = database({ products: [{ id: "product-1", tenant_id: tenant.id, is_published: true, category: "hair", name_json: { fr: "", en: "English product", es: "Producto español" }, description_json: { fr: "", en: "", es: "Descripción española" }, image_alt_json: { fr: "", en: "", es: "Imagen española" }, image_url: "https://example.invalid/product.jpg", price: 1500, currency: "EUR", stock_visibility: "not_shown" }] });
  const markets = await load("../lib/markets.ts");
  const { default: Page } = await load("../app/[locale]/salons/[slug]/page.tsx", {
    "@/lib/supabase/server": { createClient: async () => db },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/lib/i18n": { isLocale: locale => ["fr", "en", "es"].includes(locale) },
    "@/lib/markets": markets,
    "@/lib/product-localization": { localizedProductText, productDefaultLocale },
    "@/lib/published-policy": { selectPublishedPolicy },
  });
  for (const [locale, expectedName] of [["fr", "Producto español"], ["en", "English product"], ["es", "Producto español"]]) {
    const tree = await Page({ params: Promise.resolve({ locale, slug: tenant.slug }) });
    assert.ok(nodes(tree).some(node => node.type === "h4" && node.props.children === expectedName));
    assert.ok(nodes(tree).some(node => node.props?.alt === "Imagen española"));
  }
}));
test("published salon profile explains missing policies in every visitor language", async () => withConfiguration(async () => {
  const db = database();
  const markets = await load("../lib/markets.ts");
  const { default: Page } = await load("../app/[locale]/salons/[slug]/page.tsx", {
    "@/lib/supabase/server": { createClient: async () => db },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/lib/i18n": { isLocale: locale => ["fr", "en", "es"].includes(locale) },
    "@/lib/markets": markets,
    "@/lib/product-localization": { localizedProductText, productDefaultLocale },
    "@/lib/published-policy": { selectPublishedPolicy },
  });
  for (const [locale, message] of [
    ["fr", "Conditions d’annulation non publiées. Contactez le salon pour les connaître."],
    ["en", "Cancellation policies are not published. Contact the salon for details."],
    ["es", "Las condiciones de cancelación no están publicadas. Contacta con el salón para conocerlas."],
  ]) {
    const tree = await Page({ params: Promise.resolve({ locale, slug: tenant.slug }) });
    assert.ok(nodes(tree).some(node => node.type === "p" && node.props.children === message && node.props.lang === locale));
  }
}));
test("fallback salon policy keeps the published language for accessibility", async () => withConfiguration(async () => {
  const db = database({ policies: { fr: "Conditions du salon." } });
  const markets = await load("../lib/markets.ts");
  const { default: Page } = await load("../app/[locale]/salons/[slug]/page.tsx", {
    "@/lib/supabase/server": { createClient: async () => db },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/lib/i18n": { isLocale: locale => ["fr", "en", "es"].includes(locale) },
    "@/lib/markets": markets,
    "@/lib/product-localization": { localizedProductText, productDefaultLocale },
    "@/lib/published-policy": { selectPublishedPolicy },
  });
  const tree = await Page({ params: Promise.resolve({ locale: "en", slug: tenant.slug }) });
  assert.ok(nodes(tree).some(node => node.type === "p" && node.props.children === "Conditions du salon." && node.props.lang === "fr"));
}));
test("booking route preserves selected service, locale and trusted salon currency/time zone", async () => withConfiguration(async () => {
  const Page = await booking(database());
  for (const locale of ["fr", "en", "es"]) {
    const tree = await Page(request(locale, chosen));
    assert.equal(tree.props.initialServiceId, chosen);
    assert.equal(tree.props.locale, locale);
    assert.deepEqual(tree.props.services.map(s => s.id), [first, chosen]);
    assert.equal(tree.props.salon.currency, "EUR");
    assert.equal(tree.props.salon.countryCode, "ES");
    assert.equal(tree.props.salon.defaultLocale, "es");
    assert.equal(tree.props.salon.timeZone, "Europe/Madrid");
    assert.notEqual(tree.key, (await Page(request(locale, first))).key, "new selected-service navigation resets old form state");
  }
}));
test("forged, inactive, malformed, duplicate and offline service selections fail closed", async () => withConfiguration(async () => {
  const Page = await booking(database());
  for (const id of [foreign, inactive, "bad-id", "", [first, chosen]]) await assert.rejects(Page(request("fr", id)), /not-found/);
  delete process.env.SUPABASE_SECRET_KEY;
  await assert.rejects(Page({ params: Promise.resolve({ locale: "fr", slug: "atelier-belle" }), searchParams: Promise.resolve({ service: chosen }) }), /not-found/);
}));
test("unpublished salons reject direct public booking URLs while owner sandbox access remains isolated", async () => withConfiguration(async () => {
  const unpublished = database({ profilePublished: false });
  const Page = await booking(unpublished);
  await assert.rejects(Page(request("fr", chosen)), /not-found/);
  assert.ok(unpublished.queries.some(query => query.table === "salon_public_profiles" && query.filters.some(([key, value]) => key === "is_published" && value === true)));

  const SandboxPage = await booking(database({ profilePublished: false }), { sandbox: true });
  assert.equal((await SandboxPage(request("en", chosen, { sandbox: "1" }))).props.sandbox, true);
}));
test("public booking fails closed when the discovered profile country differs from the checkout market", async () => withConfiguration(async () => {
  const Page = await booking(database({ profileCountry: "FR" }));
  await assert.rejects(Page(request("es", chosen)), /not-found/);
}));
test("booking uses the configured market language even when it differs from the static country fallback", async () => withConfiguration(async () => {
  const sparse = { ...catalog[1], title_json: { fr: "", en: "English market title", es: "Spanish country title" } };
  const Page = await booking(database({ marketDefaultLocale: "en", services: [sparse] }));
  const tree = await Page(request("fr", chosen));
  assert.equal(tree.props.salon.countryCode, "ES");
  assert.equal(tree.props.salon.defaultLocale, "en");
  const payment = await load("../lib/sandbox-payment-copy.ts");
  const { LiveBookingFlow } = await load("../components/glowflow/live-booking-flow.tsx", {
    "@/lib/sandbox-payment-copy": payment,
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
  });
  const html = renderToStaticMarkup(createElement(LiveBookingFlow, tree.props));
  assert.match(html, /English market title/);
  assert.doesNotMatch(html, /Spanish country title/);
}));
test("selected service preserves sandbox owner/configuration gates and reservation status", async () => withConfiguration(async () => {
  const Page = await booking(database(), { sandbox: true });
  assert.equal((await Page(request("en", chosen, { sandbox: "1" }))).props.sandbox, true);
  assert.equal((await Page(request("en", chosen, { sandboxReservation: first }))).type, "status");
  await assert.rejects((await booking(database()))(request("en", chosen, { sandbox: "1" })), /not-found/);
  await assert.rejects((await booking(database(), { sandbox: true, owner: false }))(request("en", chosen, { sandbox: "1" })), /not-found/);
}));
test("live form selects requested catalog service and rejects foreign component props", async () => {
  const payment = await load("../lib/sandbox-payment-copy.ts");
  const { LiveBookingFlow } = await load("../components/glowflow/live-booking-flow.tsx", {
    "@/lib/sandbox-payment-copy": payment,
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
  });
  const props = { locale: "en", salon: { ...tenant, countryCode: tenant.country_code, timeZone: tenant.time_zone }, services: catalog.slice(0, 2), initialServiceId: chosen };
  const html = renderToStaticMarkup(createElement(LiveBookingFlow, props));
  assert.match(html, new RegExp(`<option value="${chosen}" selected=""`));
  assert.doesNotMatch(html, new RegExp(`<option value="${first}" selected=""`));
  assert.match(html, /42\.00/);
  assert.throws(() => renderToStaticMarkup(createElement(LiveBookingFlow, { ...props, initialServiceId: foreign })), /this salon's catalog/);
});

test("booking keeps a sparse published service title visible across locale handoff", async () => {
  await withConfiguration(async () => {
    const sparse = { ...catalog[0], title_json: { fr: "French service", en: "", es: "Spanish service" } };
    const { default: ProfilePage } = await load("../app/[locale]/salons/[slug]/page.tsx", {
      "@/lib/supabase/server": { createClient: async () => database({ services: [sparse] }) },
      "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
      "@/lib/i18n": { isLocale: locale => ["fr", "en", "es"].includes(locale) },
      "@/lib/markets": marketConfig,
      "@/lib/product-localization": { localizedProductText, productDefaultLocale },
      "@/lib/published-policy": { selectPublishedPolicy },
    });
    const profileTree = await ProfilePage({ params: Promise.resolve({ locale: "en", slug: tenant.slug }) });
    assert.ok(nodes(profileTree).some(node => node.type === "h3" && node.props.children === "Spanish service"));
    assert.ok(nodes(profileTree).some(node => node.props?.href === `/en/book/${tenant.slug}?service=${first}` && node.props["aria-label"].includes("Spanish service")));
    sparse.title_json = { fr: "", en: "", es: "" };
    const blankProfile = await ProfilePage({ params: Promise.resolve({ locale: "en", slug: tenant.slug }) });
    assert.ok(nodes(blankProfile).some(node => node.type === "h3" && node.props.children === "Service name unavailable"));
  });
  const payment = await load("../lib/sandbox-payment-copy.ts");
  const { LiveBookingFlow } = await load("../components/glowflow/live-booking-flow.tsx", {
    "@/lib/sandbox-payment-copy": payment,
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
  });
  for (const [locale, title_json, expected] of [
    ["en", { fr: "French service", en: "", es: "Spanish service" }, "Spanish service"],
    ["en", { fr: "French service", es: "Spanish service" }, "Spanish service"],
    ["fr", { fr: "", en: "English service", es: " " }, "English service"],
    ["en", { fr: "", en: "", es: "" }, "Service details unavailable"],
  ]) {
    const sparse = { ...catalog[0], title_json };
    const html = renderToStaticMarkup(createElement(LiveBookingFlow, {
      locale, salon: { ...tenant, countryCode: tenant.country_code, defaultLocale: "es", timeZone: tenant.time_zone }, services: [sparse], initialServiceId: first,
    }));
    assert.equal(localizedProductText(title_json, locale, "es") || "Service details unavailable", expected);
    assert.equal(html.split(expected).length - 1, 2, "summary and selector use the same non-empty title as the profile");
  }
});

test("changing service preserves sandbox query, hash and history state for locale navigation", async () => {
  const values = [];
  const payment = await load("../lib/sandbox-payment-copy.ts");
  const { LiveBookingFlow } = await load("../components/glowflow/live-booking-flow.tsx", {
    react: { ...require("react"), useState(value) { const index = values.length; values.push(value); return [value, next => { values[index] = next; }]; }, useEffect() {}, useRef: value => ({ current: value }), useMemo: fn => fn(), useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); } },
    "@/lib/sandbox-payment-copy": payment,
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
  });
  const previous = globalThis.window;
  const historyState = { nextRouterState: "retained" };
  const replacements = [];
  globalThis.window = { location: { href: `https://example.invalid/fr/book/salon-a?sandbox=1&service=${first}&campaign=fixture#booking` }, history: { state: historyState, replaceState: (...args) => replacements.push(args) } };
  try {
    const tree = LiveBookingFlow({ locale: "fr", salon: { ...tenant, countryCode: tenant.country_code, timeZone: tenant.time_zone }, services: catalog.slice(0, 2), initialServiceId: first });
    nodes(tree).find(node => node.type === "select").props.onChange({ target: { value: chosen } });
    assert.equal(values[0], chosen);
    assert.equal(replacements.length, 1);
    assert.equal(replacements[0][0], historyState);
    const url = new URL(replacements[0][2]);
    assert.equal(url.searchParams.get("service"), chosen);
    assert.equal(url.searchParams.get("sandbox"), "1");
    assert.equal(url.searchParams.get("campaign"), "fixture");
    assert.equal(url.hash, "#booking");
    assert.equal(url.pathname, "/fr/book/salon-a");
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

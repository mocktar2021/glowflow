import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
async function load(file, dependencies) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", js)((name) => dependencies[name] ?? require(name), loaded.exports);
  return loaded.exports;
}
const serviceId = "11111111-1111-4111-8111-111111111111";
const originalServiceId = "22222222-2222-4222-8222-222222222222";
const requestKey = "33333333-3333-4333-8333-333333333333";
const base = { appointment_id: "appointment-a", confirmed_start: "2030-06-15T23:30:00Z", confirmed_end: "2030-06-16T00:00:00Z", salon_name: "PRIVATE TENANT NAME", service_title: { en: "Wrong retried service" }, currency: "EUR", saved_locale: "en" };
const body = { salonSlug: "salon-a", serviceId, staffId: serviceId, startTime: base.confirmed_start, fullName: "Example Client", phone: "5550100", email: "", locale: "en", requestKey, price: 1, address: "Forged", policies: { en: "Free cancellation" } };
function database({ published = true, wrongTenant = false, fail = false, wrongKey = false, malformed = false, partial = false, queryError = false, currency = "USD" } = {}) {
  const queries = [];
  const records = {
    tenants: [{ id: "tenant-a", slug: "salon-a", time_zone: "Asia/Tokyo", address_line1: "PRIVATE TENANT ADDRESS" }],
    appointments: [{ id: base.appointment_id, tenant_id: "tenant-a", public_booking_request_key: wrongKey ? "other-key" : requestKey, service_id: originalServiceId }],
    services: [{ id: originalServiceId, tenant_id: "tenant-a", title_json: { fr: "Soin original", en: "Original service", es: "Servicio original" }, price: 4200, currency }],
    salon_public_profiles: [{ tenant_id: wrongTenant ? "tenant-b" : "tenant-a", is_published: published, business_name: "Public Brand", address_line1: "12 Public Street", city: "Tokyo", country_code: "JP", policies_json: { en: "Contact us 24 hours before your appointment." }, private_note: "SECRET" }],
  };
  return { queries, rpc: async () => ({ data: [base], error: null }), from(table) {
    if (fail) throw Error("private database error");
    if (malformed) {
      records.tenants[0].time_zone = "Invalid/Zone";
      records.services[0].currency = "bogus";
      records.services[0].price = -10;
      records.salon_public_profiles[0].policies_json = { en: {}, fr: 42, es: "Reglas publicadas", private_note: "SECRET" };
    }
    if (partial) records.salon_public_profiles[0].address_line1 = "  ";
    const filters = [];
    const query = { select(columns) { queries.push({ table, columns, filters }); return query; }, eq(key, value) { filters.push([key, value]); return query; }, single() { return result(); }, maybeSingle() { return result(); } };
    function result() { return Promise.resolve({ error: queryError ? { message: "query failed" } : null, data: records[table].find(row => filters.every(([key, value]) => row[key] === value)) ?? null }); }
    return query;
  } };
}
async function post(db) {
  const { POST } = await load("../app/api/public-booking/route.ts", { "@/lib/supabase/admin": { createAdminClient: () => db } });
  const response = await POST(new Request("http://localhost/api/public-booking", { method: "POST", body: JSON.stringify(body) }));
  return { response, value: await response.json() };
}
test("confirmation uses stored service and a published tenant-scoped profile, ignoring forged details", async () => {
  const db = database();
  const { response, value } = await post(db);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(value.confirmation.salon_name, "Public Brand");
  assert.deepEqual(value.confirmation.details, { time_zone: "Asia/Tokyo", address: "12 Public Street, Tokyo, JP", policies: { en: "Contact us 24 hours before your appointment." }, catalog_price: 4200, currency: "USD", service_title: { fr: "Soin original", en: "Original service", es: "Servicio original" } });
  assert.ok(db.queries.find(q => q.table === "appointments").filters.some(([key, value]) => key === "public_booking_request_key" && value === requestKey));
  assert.ok(db.queries.find(q => q.table === "services").filters.some(([key, value]) => key === "id" && value === originalServiceId));
  assert.doesNotMatch(JSON.stringify(value), /SECRET|PRIVATE|Forged|Free cancellation/);
});
test("unpublished and cross-tenant profiles never reveal address or policies", async () => {
  for (const options of [{ published: false }, { wrongTenant: true }]) {
    const { value } = await post(database(options));
    assert.equal(value.confirmation.details.address, null);
    assert.equal(value.confirmation.details.policies, null);
    assert.equal(value.confirmation.salon_name, "");
  }
});
test("committed booking stays successful if enrichment fails or request binding does not match", async () => {
  for (const options of [{ fail: true }, { wrongKey: true }]) {
    const { response, value } = await post(database(options));
    assert.equal(response.status, 201);
    assert.equal(value.confirmation.appointment_id, base.appointment_id);
    assert.equal(value.confirmation.details, null);
    assert.equal(value.confirmation.salon_name, "");
    assert.doesNotMatch(JSON.stringify(value), /private database error/);
  }
});
async function markup(locale, details, salonName = base.salon_name) {
  const confirmation = { ...base, salon_name: salonName, details };
  let stateIndex = 0;
  const { LiveBookingFlow } = await load("../components/glowflow/live-booking-flow.tsx", {
    react: { ...React, useEffect() {}, useRef: () => ({ current: null }), useMemo: (fn) => fn(), useState(initial) { return [stateIndex++ === 7 ? confirmation : initial, () => {}]; } },
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/lib/sandbox-payment-copy": { sandboxPaymentCopy: { fr: {}, en: {}, es: {} } },
  });
  return renderToStaticMarkup(React.createElement(LiveBookingFlow, { locale, salon: { name: "Published page name", slug: "salon-a", city: null, currency: "EUR", timeZone: "America/Los_Angeles" }, services: [{ id: serviceId, title_json: {}, duration_minutes: 30, price: 1, deposit_amount: 0, currency: "EUR" }] }));
}
test("confirmation localizes authoritative date, price and truthful payment copy in all three languages", async () => {
  const { value } = await post(database());
  for (const [locale, price, payment] of [["fr", "Tarif actuel de la prestation", "Aucun paiement en ligne"], ["en", "Current service price", "No online payment"], ["es", "Precio actual del servicio", "No se ha cobrado"]]) {
    const html = await markup(locale, value.confirmation.details, value.confirmation.salon_name);
    assert.match(html, new RegExp(price));
    assert.match(html, new RegExp(payment));
    assert.match(html, /Asia\/Tokyo/);
    assert.match(html, /16/);
    assert.match(html, /42/);
    assert.match(html, /USD/);
    assert.match(html, /12 Public Street/);
    assert.match(html, /Public Brand/);
    assert.match(html, /lang="en"/);
    assert.doesNotMatch(html, /Wrong retried service|Published page name|PRIVATE TENANT NAME|Los_Angeles/);
  }
});
test("missing confirmation enrichment falls back to the published booking-page name", async () => {
  const { value } = await post(database({ fail: true }));
  const html = await markup("en", value.confirmation.details, value.confirmation.salon_name);
  assert.match(html, /Published page name/);
  assert.doesNotMatch(html, /PRIVATE TENANT NAME/);
});
test("missing policy and address are explicit, and published text is escaped", async () => {
  for (const [locale, missing] of [["fr", "Adresse non publiée"], ["en", "Address not published"], ["es", "Dirección no publicada"]]) {
    assert.ok((await markup(locale, null)).includes(missing));
  }
  const html = await markup("en", { time_zone: "UTC", address: "<script>bad</script>", policies: { en: "<img src=x onerror=bad>" }, catalog_price: null, currency: null, service_title: null });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<img src=x/);
});

test("malformed public JSON, currency and time zone degrade without breaking a committed booking", async () => {
  const { value } = await post(database({ malformed: true }));
  assert.equal(value.confirmation.details.time_zone, null);
  assert.equal(value.confirmation.details.currency, null);
  assert.equal(value.confirmation.details.catalog_price, null);
  assert.deepEqual(value.confirmation.details.policies, { es: "Reglas publicadas" });
  const html = await markup("en", value.confirmation.details);
  assert.match(html, /Price unavailable/);
  assert.match(html, /lang="es"/);
  assert.doesNotMatch(html, /SECRET|Invalid\/Zone|bogus/);
});
test("partial published address is unavailable and query errors never supply confirmation details", async () => {
  assert.equal((await post(database({ partial: true }))).value.confirmation.details.address, null);
  assert.equal((await post(database({ queryError: true }))).value.confirmation.details, null);
});
test("failed enrichment cannot display a different service from a modified idempotent retry", async () => {
  const { value } = await post(database({ fail: true }));
  assert.equal(value.confirmation.service_title.en, "Wrong retried service");
  const html = await markup("en", value.confirmation.details);
  assert.match(html, /Service details unavailable/);
  assert.doesNotMatch(html, /Wrong retried service/);
});
test("catalog cents are not displayed as currencies with other minor-unit exponents", async () => {
  for (const currency of ["JPY", "KWD"]) {
    const { value } = await post(database({ currency }));
    assert.equal(value.confirmation.details.currency, null);
    assert.match(await markup("en", value.confirmation.details), /Price unavailable/);
  }
});

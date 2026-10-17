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
const payment = await load("../lib/sandbox-payment-copy.ts");
const bookingStaff = await load("../lib/public-booking-staff.ts");
const props = { locale: "fr", salon: { name: "Salon Test", slug: "salon-test", city: "Paris", currency: "EUR", timeZone: "Europe/Paris" }, services: [{ id: "service", title_json: { fr: "Coupe", en: "Haircut", es: "Corte" }, duration_minutes: 30, price: 3000, deposit_amount: 1000, currency: "EUR" }] };
const slot = { slot_start: "2026-09-12T10:00:00Z", staff_id: "public-staff-id" };
async function harness(initial = {}) {
  const values = [], refs = [], effects = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  const react = {
    useState(value) { const index = stateIndex++; if (!(index in values)) values[index] = index in initial ? initial[index] : value; return [values[index], (next) => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useRef(value) { const index = refIndex++; return refs[index] ??= { current: value }; },
    useMemo(fn) { return fn(); },
    useEffect(fn, deps) { const index = effectIndex++; const last = effects[index]; if (!last || deps.some((value, i) => value !== last.deps[i])) { last?.cleanup?.(); effects[index] = { fn, deps, pending: true }; } },
  };
  const { LiveBookingFlow } = await load("../components/glowflow/live-booking-flow.tsx", {
    react,
    "lucide-react": { CalendarDays: "svg", CheckCircle2: "svg", Clock3: "svg", MapPin: "svg", Sparkles: "svg" },
    "next/link": ({ children }) => children,
    "@/components/glowflow/language-switcher": { LanguageSwitcher: () => null },
    "@/lib/sandbox-payment-copy": payment,
  });
  return { values, refs, render(extra = {}) { stateIndex = refIndex = effectIndex = 0; return LiveBookingFlow({ ...props, ...extra }); }, runEffects() { for (const effect of effects) if (effect.pending) { effect.pending = false; effect.cleanup = effect.fn(); } }, cleanup() { effects.forEach((effect) => effect.cleanup?.()); } };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function find(tree, predicate) { return nodes(tree).find(predicate); }
const settle = () => new Promise((resolve) => setImmediate(resolve));
test("public booking renders native accessible time selection and localized contact guidance", async () => {
  for (const [locale, phrase] of [["fr", "Sans préférence"], ["en", "No preference"], ["es", "Sin preferencia"]]) {
    const h = await harness({ 2: [slot], 3: slot, 4: false });
    const tree = h.render({ locale });
    const radio = find(tree, (node) => node.type === "input" && node.props.type === "radio");
    assert.equal(radio.props.checked, true);
    assert.equal(radio.props.name, "bookingTime");
    assert.equal(radio.props.required, true);
    assert.equal(find(tree, (node) => node.props?.name === "phone").props.autoComplete, "tel");
    assert.equal(find(tree, (node) => node.props?.name === "email").props["aria-describedby"], "booking-contact-hint");
    const html = renderToStaticMarkup(tree);
    assert.ok(html.includes(phrase));
    assert.ok(html.includes("Europe/Paris"));
    assert.ok(html.includes("Salon Test"));
    assert.ok(!html.includes("public-staff-id"));
  }
});
test("aborted earlier availability cannot clear loading or replace newer slots", async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, options) => new Promise((resolve) => requests.push({ resolve, signal: options.signal }));
  try {
    const h = await harness();
    let tree = h.render(); h.runEffects();
    const nextDate = new Date(Date.parse(`${h.values[1]}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    find(tree, (node) => node.type === "input" && node.props.type === "date").props.onChange({ target: { value: nextDate } });
    tree = h.render(); h.runEffects();
    assert.equal(requests[0].signal.aborted, true);
    requests[0].resolve({ ok: true, json: async () => ({ slots: [slot] }) }); await settle();
    assert.equal(h.values[4], true); assert.deepEqual(h.values[2], []);
    const newer = { ...slot, slot_start: `${nextDate}T12:00:00Z` };
    requests[1].resolve({ ok: true, json: async () => ({ slots: [newer] }) }); await settle();
    assert.equal(h.values[4], false); assert.deepEqual(h.values[2], [newer]); h.cleanup();
  } finally { globalThis.fetch = originalFetch; }
});
test("availability error offers retry and stale selection is cleared when service changes", async () => {
  const h = await harness({ 2: [slot], 3: slot, 4: false, 8: true });
  let tree = h.render();
  const retry = find(tree, (node) => node.type === "button" && node.props.children === "Réessayer");
  assert.ok(retry); retry.props.onClick();
  assert.equal(h.values[3], null); assert.equal(h.values[4], true); assert.equal(h.values[8], false);
  tree = h.render();
  assert.equal(find(tree, (node) => node.type === "button" && node.props.type === "submit").props.disabled, true);
  find(tree, (node) => node.type === "select").props.onChange({ target: { value: "other-service" } });
  assert.deepEqual(h.values[2], []); assert.equal(h.values[3], null);
});
test("named staff choice filters slots without losing the no-preference option", async () => {
  const other = { ...slot, staff_id: "other-staff", slot_start: "2026-09-12T11:00:00Z" };
  const sameTime = { ...slot, staff_id: "other-staff" };
  const h = await harness({ 2: [slot, sameTime, other], 4: false });
  const extra = { bookingStaffByService: { service: [{ id: "other-staff", name: "Ari" }] } };
  let tree = h.render(extra);
  const staffSelect = find(tree, (node) => node.type === "select" && node.props.value === "");
  assert.ok(staffSelect);
  assert.equal(nodes(tree).filter((node) => node.type === "input" && node.props.name === "bookingTime").length, 2);
  staffSelect.props.onChange({ target: { value: "other-staff" } });
  assert.equal(h.values[10], "other-staff");
  tree = h.render(extra);
  assert.equal(nodes(tree).filter((node) => node.type === "input" && node.props.name === "bookingTime").length, 2);
  assert.ok(renderToStaticMarkup(tree).includes("Ari"));
  h.values[2] = [slot];
  tree = h.render(extra);
  assert.ok(renderToStaticMarkup(tree).includes("Aucun créneau pour ce professionnel"));
  find(tree, (node) => node.type === "button" && node.props.children === "Voir tous les professionnels").props.onClick();
  assert.equal(h.values[10], "");
  tree = h.render(extra);
  assert.equal(nodes(tree).filter((node) => node.type === "input" && node.props.name === "bookingTime").length, 1);
});
test("booking another appointment reloads availability instead of reusing the booked slot", async () => {
  const h = await harness({ 2: [slot], 3: slot, 4: false, 7: { appointment_id: "reference", service_title: { fr: "Coupe" }, confirmed_start: slot.slot_start, confirmed_end: "2026-09-12T10:30:00Z", salon_name: "Salon Test", currency: "EUR", saved_locale: "fr" } });
  const tree = h.render();
  find(tree, (node) => node.type === "button").props.onClick();
  assert.equal(h.values[7], null); assert.equal(h.values[3], null); assert.equal(h.values[4], true);
});
test("offline unknown salon slugs fail closed while explicit atelier demo remains", async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSecret = process.env.SUPABASE_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY;
  try {
    const { default: Page } = await load("../app/[locale]/book/[slug]/page.tsx", {
      "next/navigation": { notFound: () => { throw new Error("not-found"); } },
      "@/components/glowflow/booking-flow": { BookingFlow: "demo" },
      "@/components/glowflow/live-booking-flow": { LiveBookingFlow: "live" },
      "@/components/glowflow/sandbox-payment-status": { SandboxPaymentStatusPanel: "sandbox" },
      "@/lib/i18n": { isLocale: (locale) => ["fr", "en", "es"].includes(locale) },
      "@/lib/public-booking-staff": bookingStaff,
      "@/lib/stripe-sandbox": { sandboxOwner: () => { throw new Error("unexpected-owner"); } },
      "@/lib/stripe-deposits-config": { sandboxDepositConfiguration: () => null },
      "@/lib/supabase/admin": { createAdminClient: () => { throw new Error("unexpected-admin"); } },
    });
    await assert.rejects(Page({ params: Promise.resolve({ locale: "fr", slug: "unknown" }), searchParams: Promise.resolve({}) }), /not-found/);
    assert.equal((await Page({ params: Promise.resolve({ locale: "fr", slug: "atelier-belle" }), searchParams: Promise.resolve({}) })).type, "demo");
    await assert.rejects(Page({ params: Promise.resolve({ locale: "fr", slug: "atelier-belle" }), searchParams: Promise.resolve({ sandbox: "1" }) }), /not-found/);
  } finally {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = originalSecret;
  }
});
test("localized booking resolves only published tenant services and passes an explicit public field set", async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.invalid";
  process.env.SUPABASE_SECRET_KEY = "fixture-only";
  const primary = "11111111-1111-4111-8111-111111111111";
  const foreign = "22222222-2222-4222-8222-222222222222";
  const tables = {
    tenants: [
      { id: "tenant-a", name: "Published Salon", slug: "published", city: "Paris", currency: "EUR", time_zone: "Europe/Paris", is_booking_enabled: true, private_note: "never send" },
      { id: "tenant-b", name: "Hidden Salon", slug: "hidden", city: "Madrid", currency: "EUR", time_zone: "Europe/Madrid", is_booking_enabled: true },
    ],
    salon_public_profiles: [{ tenant_id: "tenant-a", business_name: "Public Brand", is_published: true, team_json: [{ name: "Ari", booking_staff_id: "33333333-3333-4333-8333-333333333333" }, { name: "Foreign", booking_staff_id: "44444444-4444-4444-8444-444444444444" }] }, { tenant_id: "tenant-b", business_name: "Hidden Brand", is_published: false }],
    users: [{ id: "33333333-3333-4333-8333-333333333333", tenant_id: "tenant-a" }, { id: "44444444-4444-4444-8444-444444444444", tenant_id: "tenant-b" }],
    service_staff: [{ service_id: primary, staff_id: "33333333-3333-4333-8333-333333333333", tenant_id: "tenant-a" }],
    services: [
      { id: primary, tenant_id: "tenant-a", title_json: { fr: "Coupe", en: "Haircut", es: "Corte" }, duration_minutes: 30, price: 3000, deposit_amount: 1000, currency: "EUR", is_active: true, internal_cost: 1200 },
      { id: foreign, tenant_id: "tenant-b", title_json: { fr: "Secret" }, duration_minutes: 30, price: 4000, deposit_amount: 0, currency: "EUR", is_active: true },
    ],
  };
  const selections = [];
  const createAdminClient = () => ({ from(table) {
    const filters = [], included = [];
    let columns = [];
    const query = {
      select(value) { columns = value.split(","); selections.push({ table, columns }); return query; },
      eq(column, value) { filters.push([column, value]); return query; },
      in(column, values) { included.push([column, values]); return query; },
      order() { return Promise.resolve({ data: resolve() }); },
      single() { return Promise.resolve({ data: resolve()[0] ?? null }); },
      maybeSingle() { return Promise.resolve({ data: resolve()[0] ?? null }); },
      then(onFulfilled, onRejected) { return Promise.resolve({ data: resolve(), error: null }).then(onFulfilled, onRejected); },
    };
    function resolve() { return tables[table].filter(row => filters.every(([column, value]) => row[column] === value) && included.every(([column, values]) => values.includes(row[column]))).map(row => Object.fromEntries(columns.map(column => [column, row[column]]))); }
    return query;
  } });
  try {
    const { default: Page } = await load("../app/[locale]/book/[slug]/page.tsx", {
      "next/navigation": { notFound: () => { throw new Error("not-found"); } },
      "@/components/glowflow/booking-flow": { BookingFlow: "demo" },
      "@/components/glowflow/live-booking-flow": { LiveBookingFlow: "live" },
      "@/components/glowflow/sandbox-payment-status": { SandboxPaymentStatusPanel: "sandbox" },
      "@/lib/i18n": { isLocale: locale => ["fr", "en", "es"].includes(locale) },
      "@/lib/public-booking-staff": bookingStaff,
      "@/lib/stripe-sandbox": { sandboxOwner: () => { throw new Error("unexpected-owner"); } },
      "@/lib/stripe-deposits-config": { sandboxDepositConfiguration: () => null },
      "@/lib/supabase/admin": { createAdminClient },
    });
    const render = (locale, slug, service) => Page({ params: Promise.resolve({ locale, slug }), searchParams: Promise.resolve(service ? { service } : {}) });
    for (const locale of ["fr", "en", "es"]) {
      const result = await render(locale, "published", primary);
      assert.equal(result.type, "live");
      assert.equal(result.props.locale, locale);
      assert.equal(result.props.initialServiceId, primary);
      assert.deepEqual(result.props.salon, { name: "Public Brand", slug: "published", city: "Paris", currency: "EUR", timeZone: "Europe/Paris" });
      assert.deepEqual(result.props.services.map(service => service.id), [primary]);
      assert.deepEqual(result.props.bookingStaffByService[primary], [{ id: "33333333-3333-4333-8333-333333333333", name: "Ari" }]);
      assert.equal("private_note" in result.props.salon, false);
      assert.equal("internal_cost" in result.props.services[0], false);
    }
    for (const [locale, slug, service] of [["fr", "hidden", null], ["en", "unknown", null], ["es", "published", foreign], ["de", "published", null]]) {
      await assert.rejects(render(locale, slug, service), /not-found/);
    }
    assert.ok(selections.every(({ table, columns }) => table !== "tenants" || !columns.includes("private_note")));
    assert.ok(selections.every(({ table, columns }) => table !== "services" || !columns.includes("internal_cost")));
  } finally {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = originalSecret;
  }
});

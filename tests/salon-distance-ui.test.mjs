import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

import { coarseVisitorOrigin, maximumPriceMinorUnits, salonSearchPage } from "../lib/salon-search.ts";

const require = createRequire(import.meta.url);
const component = await readFile(new URL("../components/glowflow/distance-search.tsx", import.meta.url), "utf8");
const ownerControl = await readFile(new URL("../app/[locale]/dashboard/public-profile/map-point-control.tsx", import.meta.url), "utf8");
const ownerPage = await readFile(new URL("../app/[locale]/dashboard/public-profile/page.tsx", import.meta.url), "utf8");
const ownerAction = await readFile(new URL("../app/[locale]/dashboard/public-profile/actions.ts", import.meta.url), "utf8");

test("visitor origin is bounded and rounded before it reaches the search RPC", () => {
  assert.deepEqual(coarseVisitorOrigin(36.0726, -79.7915), { origin_lat: 36.07, origin_lon: -79.79 });
  assert.equal(coarseVisitorOrigin(91, 0), null);
  assert.equal(coarseVisitorOrigin(0, Number.POSITIVE_INFINITY), null);
});

test("price and page inputs cannot overflow search arguments", () => {
  assert.equal(maximumPriceMinorUnits("45.50", "USD"), 4550);
  assert.equal(maximumPriceMinorUnits("45", "EUR"), 4500);
  assert.equal(maximumPriceMinorUnits("45", null), null);
  assert.equal(maximumPriceMinorUnits("999999999999999999999", "USD"), null);
  assert.equal(salonSearchPage("2"), 2);
  assert.equal(salonSearchPage("999999999999999999999"), 1);
});

test("distance search requests browser location only after a click and sends only coarse coordinates", async () => {
  const js = ts.transpileModule(component, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const state = [];
  let index = 0;
  let geolocationCalls = 0;
  const rpcCalls = [];
  const loaded = { exports: {} };
  const deps = {
    react: { useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], (value) => { state[slot] = value; }]; }, useRef(initial) { return { current: initial }; } },
    "@/components/glowflow/marketplace-salon-card": { MarketplaceSalonCard: () => null },
    "@/lib/i18n": { salonProfileLocale: () => "en" },
    "@/lib/markets": { fallbackMarkets: [] },
    "@/lib/marketplace-locations": { marketplaceLocation: () => null, marketplaceLocationHref: () => "" },
    "@/lib/salon-search": { coarseVisitorOrigin },
    "@/lib/salon-time-zones": { publicSalonTimeZones: async () => ({}) },
    "@/lib/supabase/client": { createClient: () => ({ rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: [{ slug: "test", distance_meters: 100, total_count: 1 }], error: null }; } }) },
  };
  const browser = { geolocation: { getCurrentPosition(success) { geolocationCalls++; success({ coords: { latitude: 36.0726, longitude: -79.7915 } }); } } };
  new Function("require", "exports", "navigator", js)(name => deps[name] ?? require(name), loaded.exports, browser);
  const tree = loaded.exports.DistanceSearch({ children: "existing results", locale: "en", labels: {}, filters: { filter_country_code: "US" }, pageSize: 9, visitorPreference: null, countryDefaultLocales: {}, initialSalonTimeZones: {}, enabled: true });
  assert.equal(geolocationCalls, 0);
  const findAction = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "button" && node.props.children === "Sort near me") return node.props.onClick;
    const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
    for (const child of children) { const action = findAction(child); if (action) return action; }
    return null;
  };
  const action = findAction(tree);
  assert.equal(typeof action, "function");
  action();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(geolocationCalls, 1);
  assert.equal(rpcCalls[0].name, "search_public_salons_by_distance");
  assert.equal(rpcCalls[0].args.origin_lat, 36.07);
  assert.equal(rpcCalls[0].args.origin_lon, -79.79);
  assert.doesNotMatch(component, /localStorage|sessionStorage|window\.location|console\./);
});

test("stopping a pending location request ignores late success and denial callbacks", async () => {
  const js = ts.transpileModule(component, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const state = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  const callbacks = [];
  const rpcCalls = [];
  const loaded = { exports: {} };
  const deps = {
    react: {
      useState(initial) { const slot = stateIndex++; if (!(slot in state)) state[slot] = initial; return [state[slot], (value) => { state[slot] = typeof value === "function" ? value(state[slot]) : value; }]; },
      useRef(initial) { const slot = refIndex++; return refs[slot] ??= { current: initial }; },
    },
    "@/components/glowflow/marketplace-salon-card": { MarketplaceSalonCard: () => null },
    "@/lib/i18n": { salonProfileLocale: () => "en" },
    "@/lib/markets": { fallbackMarkets: [] },
    "@/lib/marketplace-locations": { marketplaceLocation: () => null, marketplaceLocationHref: () => "" },
    "@/lib/salon-search": { coarseVisitorOrigin },
    "@/lib/salon-time-zones": { publicSalonTimeZones: async () => ({}) },
    "@/lib/supabase/client": { createClient: () => ({ rpc: async (...args) => { rpcCalls.push(args); return { data: [], error: null }; } }) },
  };
  const browser = { geolocation: { getCurrentPosition(success, error) { callbacks.push({ success, error }); } } };
  new Function("require", "exports", "navigator", js)(name => deps[name] ?? require(name), loaded.exports, browser);
  const render = () => {
    stateIndex = refIndex = 0;
    return loaded.exports.DistanceSearch({ children: "existing results", locale: "en", labels: {}, filters: {}, pageSize: 9, visitorPreference: null, countryDefaultLocales: {}, initialSalonTimeZones: {}, enabled: true });
  };
  const button = (node, label) => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "button" && node.props.children === label) return node.props.onClick;
    for (const child of Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]) {
      const action = button(child, label);
      if (action) return action;
    }
    return null;
  };

  button(render(), "Sort near me")();
  assert.equal(callbacks.length, 1);
  const stop = button(render(), "Stop distance sorting");
  assert.equal(typeof stop, "function");
  stop();
  callbacks[0].success({ coords: { latitude: 36.0726, longitude: -79.7915 } });
  callbacks[0].error(new Error("late denial"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rpcCalls.length, 0);
  assert.equal(button(render(), "Stop distance sorting"), null);

  button(render(), "Sort near me")();
  assert.equal(callbacks.length, 2);
  callbacks[0].error(new Error("old denial"));
  assert.equal(typeof button(render(), "Stop distance sorting"), "function");
  callbacks[1].success({ coords: { latitude: 36.0726, longitude: -79.7915 } });
  button(render(), "Stop distance sorting")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rpcCalls.length, 0);
});

test("all localized distance and paging controls render a visible keyboard focus outline", () => {
  const js = ts.transpileModule(component, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const labels = [
    ["fr", "Trier près de moi", "Arrêter le tri par distance", "Précédent", "Suivant"],
    ["en", "Sort near me", "Stop distance sorting", "Previous", "Next"],
    ["es", "Ordenar cerca de mí", "Dejar de ordenar por distancia", "Anterior", "Siguiente"],
  ];
  for (const [locale, ...buttonLabels] of labels) {
    const state = [null, [], 2, 27];
    let stateIndex = 0;
    const loaded = { exports: {} };
    const deps = {
      react: { useState(initial) { const slot = stateIndex++; return [state[slot] ?? initial, () => {}]; }, useRef(initial) { return { current: initial }; } },
      "@/components/glowflow/marketplace-salon-card": { MarketplaceSalonCard: () => null },
      "@/lib/i18n": { salonProfileLocale: () => locale },
      "@/lib/markets": { fallbackMarkets: [] },
      "@/lib/marketplace-locations": { marketplaceLocation: () => null, marketplaceLocationHref: () => "" },
      "@/lib/salon-search": { coarseVisitorOrigin },
      "@/lib/salon-time-zones": { publicSalonTimeZones: async () => ({}) },
    };
    new Function("require", "exports", js)(name => deps[name] ?? require(name), loaded.exports);
    const tree = loaded.exports.DistanceSearch({ children: "existing results", locale, labels: {}, filters: {}, pageSize: 9, visitorPreference: null, countryDefaultLocales: {}, initialSalonTimeZones: {}, enabled: true });
    const buttons = [];
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "button") buttons.push(node);
      for (const child of Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]) visit(child);
    };
    visit(tree);
    assert.deepEqual(buttons.map((button) => button.props.children), buttonLabels, `${locale} controls`);
    for (const button of buttons) {
      assert.match(button.props.className, /focus-visible:outline-solid/);
      assert.match(button.props.className, /focus-visible:outline-2/);
      assert.match(button.props.className, /focus-visible:outline-offset-2/);
      assert.match(button.props.className, /focus-visible:outline-\[#8a5728\]/);
      assert.match(button.props.className, /dark:focus-visible:outline-\[#efc992\]/);
    }
  }
});

test("owner point editing is explicit, optional, and compatible with a pre-migration profile save", () => {
  assert.match(ownerControl, /type="button" onClick={useDeviceLocation}/);
  assert.match(ownerControl, /name="map_latitude"/);
  assert.match(ownerControl, /name="map_longitude"/);
  assert.match(ownerPage, /mapPointSupported \? <MapPointControl/);
  assert.match(ownerAction, /\.upsert\(\{/);
  assert.match(ownerAction, /if \(hasMapPoint\) \{[\s\S]*?\.update\(\{ map_latitude: mapLatitude, map_longitude: mapLongitude \}\)/);
  assert.match(ownerPage, /mapPointWarnings\[locale\]/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const workerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const proxySource = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");

function workerWith(networkFetch) {
  const listeners = new Map();
  const context = {
    URL,
    Response,
    fetch: networkFetch,
    setTimeout,
    caches: { open() { throw new Error("Response caching is forbidden"); } },
    self: {
      location: { origin: "https://glowflow.mocktar.com" },
      addEventListener(type, listener) { listeners.set(type, listener); },
      skipWaiting() {},
      clients: { claim() { return Promise.resolve(); } },
    },
  };
  runInNewContext(workerSource, context);
  return listeners;
}

function dispatchFetch(listeners, request) {
  let responsePromise;
  listeners.get("fetch")({ request, respondWith(promise) { responsePromise = promise; } });
  return responsePromise;
}

test("successful navigation is fetched live and never cached", async () => {
  const live = new Response("live private content");
  const listeners = workerWith(async () => live);
  const response = await dispatchFetch(listeners, {
    method: "GET", mode: "navigate", url: "https://glowflow.mocktar.com/en/dashboard/clients",
  });
  assert.equal(response, live);
});

test("network failure shows a no-store offline page in each locale", async () => {
  const listeners = workerWith(async () => { throw new TypeError("network offline"); });
  for (const [locale, expected] of [["fr", "hors ligne"], ["en", "offline"], ["es", "sin conexión"]]) {
    const response = await dispatchFetch(listeners, {
      method: "GET", mode: "navigate", url: `https://glowflow.mocktar.com/${locale}/book/example`,
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const html = await response.text();
    assert.match(html, new RegExp(`<html lang="${locale}">`));
    assert.ok(html.includes(expected));
    assert.ok(!html.includes("live private content"));
  }
});

test("unlocalized installed launch falls back to French when preference storage is unavailable", async () => {
  const listeners = workerWith(async () => { throw new TypeError("network offline"); });
  const response = await dispatchFetch(listeners, {
    method: "GET", mode: "navigate", url: "https://glowflow.mocktar.com/salons",
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(await response.text(), /<html lang="fr">/);
  let extended = false;
  listeners.get("message")({ data: { type: "glowflow-locale", locale: "../en" }, waitUntil() { extended = true; } });
  assert.equal(extended, false);
});

test("PWA registration sends the current validated page locale to the worker", async () => {
  const source = readFileSync(new URL("../components/glowflow/pwa-registration.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let effect;
  let controllerChange;
  const calls = [];
  const serviceWorker = {
    controller: { postMessage: message => calls.push(["old-controller", message]) },
    register: async (...args) => { calls.push(["register", ...args]); },
    ready: Promise.resolve({ active: { postMessage: message => calls.push(["message", message]) } }),
    addEventListener: (type, callback) => {
      assert.equal(type, "controllerchange");
      controllerChange = callback;
    },
    removeEventListener: (type, callback) => {
      assert.equal(type, "controllerchange");
      assert.equal(callback, controllerChange);
      controllerChange = undefined;
    },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", "window", "navigator", compiled)(
    name => name === "react" ? { useEffect: callback => { effect = callback; } } : require(name),
    loaded, loaded.exports,
    { env: { NODE_ENV: "production" } },
    { isSecureContext: true },
    { serviceWorker },
  );
  loaded.exports.PwaRegistration({ locale: "es" });
  assert.equal(typeof effect, "function");
  const cleanup = effect();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [
    ["register", "/sw.js", { scope: "/" }],
    ["old-controller", { type: "glowflow-locale", locale: "es" }],
  ]);
  serviceWorker.controller = { postMessage: message => calls.push(["new-controller", message]) };
  controllerChange();
  assert.deepEqual(calls.at(-1), ["new-controller", { type: "glowflow-locale", locale: "es" }]);
  cleanup();
  assert.equal(controllerChange, undefined);
});

test("mutations, subresources and other origins bypass the worker", () => {
  const listeners = workerWith(async () => { throw new Error("unexpected fetch"); });
  for (const request of [
    { method: "POST", mode: "navigate", url: "https://glowflow.mocktar.com/api/public-booking" },
    { method: "GET", mode: "cors", url: "https://glowflow.mocktar.com/api/public-booking" },
    { method: "GET", mode: "navigate", url: "https://example.com/en/salons" },
  ]) assert.equal(dispatchFetch(listeners, request), undefined);
});

test("the service worker script bypasses session-refresh middleware", () => {
  const matcherLiteral = proxySource.match(/matcher: \[("[^"\n]+")\]/)?.[1];
  assert.ok(matcherLiteral);
  const matcher = new RegExp(JSON.parse(matcherLiteral));
  assert.equal(matcher.test("/sw.js"), false);
  assert.equal(matcher.test("/swXjs"), true);
  assert.equal(matcher.test("/en/salons"), true);
});

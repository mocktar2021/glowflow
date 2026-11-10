import assert from "node:assert/strict";
import { test } from "node:test";

import { probePublicRelease } from "./public-release-smoke.mjs";

const origin = "https://glowflow.mocktar.com";
const locales = ["fr", "en", "es"];
const publicPages = ["", "/salons", "/salons/locations/US", "/salons/locations/US/Greensboro", "/login", "/privacy", "/terms", "/support"];

function successFor(url) {
  const route = new URL(url).pathname;
  if (route === "/") return new Response(null, { status: 307, headers: { location: "/fr" } });
  if (route.endsWith("/dashboard/clients")) {
    return new Response(null, { status: 307, headers: { location: `${route.slice(0, 3)}/login` } });
  }
  return new Response(null, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

test("public smoke uses only anonymous, exact-origin GETs and never follows redirects", async () => {
  const requests = [];
  const result = await probePublicRelease(async (url, options) => {
    requests.push({ url, options });
    return successFor(url);
  });

  assert.equal(result.origin, origin);
  assert.equal(result.checks.length, 28);
  assert.equal(requests.length, 28);
  assert.deepEqual(result.checks.map(check => check.route), [
    "/",
    ...locales.flatMap(locale => [...publicPages.map(page => `/${locale}${page}`), `/${locale}/dashboard/clients`]),
  ]);
  for (const { url, options } of requests) {
    assert.equal(new URL(url).origin, origin);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    assert.equal(options.body, undefined);
    assert.equal(options.headers, undefined);
    assert.ok(options.signal instanceof AbortSignal, "Each GET has a bounded timeout");
  }
  for (const check of result.checks) {
    assert.ok(Number.isSafeInteger(check.duration_ms) && check.duration_ms >= 0,
      "Each successful route reports a nonnegative, rounded header latency sample");
  }
});

test("public smoke keeps per-route latency samples separate and does not claim a p95", async () => {
  let tick = 0;
  const result = await probePublicRelease(async url => {
    tick += 7;
    return successFor(url);
  }, () => tick);
  assert.deepEqual(result.checks.map(check => check.duration_ms), Array(28).fill(7));
  assert.equal(Object.hasOwn(result, "p95"), false);
});

test("public smoke hides network exception details", async () => {
  await assert.rejects(
    probePublicRelease(async () => { throw new Error("token=private-secret"); }),
    error => error.message === "/: anonymous GET failed" && !error.message.includes("private-secret"),
  );
});

test("public smoke rejects invalid timing samples", async () => {
  for (const samples of [[10, 9], [0, Number.NaN], [0, Number.POSITIVE_INFINITY]]) {
    let index = 0;
    await assert.rejects(
      probePublicRelease(successFor, () => samples[index++]),
      /\/: invalid probe clock/,
    );
  }
});

test("public smoke fails closed if anonymous clients are exposed", async () => {
  await assert.rejects(
    probePublicRelease(async url => new URL(url).pathname === "/fr/dashboard/clients"
      ? new Response("client data", { status: 200 })
      : successFor(url)),
    /\/fr\/dashboard\/clients: expected an authentication or locale redirect/,
  );
});

test("public smoke rejects an off-origin redirect without disclosing its destination", async () => {
  await assert.rejects(
    probePublicRelease(async url => new URL(url).pathname === "/"
      ? new Response(null, { status: 307, headers: { location: "https://example.invalid/private?token=secret" } })
      : successFor(url)),
    error => !error.message.includes("secret") && /redirect did not stay/.test(error.message),
  );
});

test("public smoke rejects protected, missing, or non-HTML public pages", async () => {
  for (const response of [
    new Response(null, { status: 401 }),
    new Response(null, { status: 404 }),
    new Response(null, { status: 200, headers: { "content-type": "application/json" } }),
  ]) {
    await assert.rejects(
      probePublicRelease(async url => new URL(url).pathname === "/en/salons" ? response : successFor(url)),
      /\/en\/salons: expected a public HTML 200/,
    );
  }
});

test("public smoke fails closed for country and city location pages in every locale", async () => {
  for (const [route, response] of [
    ["/fr/salons/locations/US", new Response(null, { status: 404 })],
    ["/en/salons/locations/US/Greensboro", new Response(null, { status: 307, headers: { location: "/en/login" } })],
    ["/es/salons/locations/US", new Response(null, { status: 200, headers: { "content-type": "application/json" } })],
  ]) {
    await assert.rejects(
      probePublicRelease(async url => new URL(url).pathname === route ? response : successFor(url)),
      error => error.message.includes(`${route}: expected a public HTML 200`),
    );
  }
});

test("public smoke fails if a localized login destination does not render", async () => {
  await assert.rejects(
    probePublicRelease(async url => new URL(url).pathname === "/es/login"
      ? new Response(null, { status: 404 })
      : successFor(url)),
    /\/es\/login: expected a public HTML 200, got 404/,
  );
});

test("public smoke fails if a localized legal or support route does not render HTML", async () => {
  for (const [route, response] of [
    ["/fr/privacy", new Response(null, { status: 404 })],
    ["/en/terms", new Response(null, { status: 307, headers: { location: "/en/login" } })],
    ["/es/support", new Response(null, { status: 200, headers: { "content-type": "application/json" } })],
  ]) {
    await assert.rejects(
      probePublicRelease(async url => new URL(url).pathname === route ? response : successFor(url)),
      error => error.message.includes(`${route}: expected a public HTML 200`),
    );
  }
});

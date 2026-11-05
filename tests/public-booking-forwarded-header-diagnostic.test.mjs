import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { NextResponse } from "next/server.js";
import ts from "typescript";

const require = createRequire(import.meta.url);
const routeSource = await readFile(new URL("../app/api/public-booking/v2/forwarded-header-diagnostic/route.ts", import.meta.url), "utf8");

async function load(file, dependencies = {}) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", js)((name) =>
    Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), loaded.exports);
  return loaded.exports;
}

const quotaKeys = await load("../lib/public-booking-quota-keys.ts", { "server-only": {} });
const { GET } = await load("../app/api/public-booking/v2/forwarded-header-diagnostic/route.ts", {
  "next/server": { NextResponse },
  "@/lib/public-booking-quota-keys": quotaKeys,
});
const endpoint = "https://glowflow-preview.example.invalid/api/public-booking/v2/forwarded-header-diagnostic";
const envKeys = ["VERCEL_ENV", "GLOWFLOW_PUBLIC_BOOKING_HEADER_DIAGNOSTIC_ENABLED", "GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED"];

function withEnv(values, run) {
  const before = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of envKeys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    return run();
  } finally {
    for (const key of envKeys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

function request(headers = {}) {
  return new Request(endpoint, { headers });
}

function enabledGet(headers = {}) {
  return withEnv({ VERCEL_ENV: "preview", GLOWFLOW_PUBLIC_BOOKING_HEADER_DIAGNOSTIC_ENABLED: "true" },
    () => GET(request(headers)));
}

test("diagnostic is off by default and cannot run in production or with booking v2 on", async () => {
  const denied = [
    {},
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "preview", GLOWFLOW_PUBLIC_BOOKING_HEADER_DIAGNOSTIC_ENABLED: "TRUE" },
    { VERCEL_ENV: "development", GLOWFLOW_PUBLIC_BOOKING_HEADER_DIAGNOSTIC_ENABLED: "true" },
    { VERCEL_ENV: "production", GLOWFLOW_PUBLIC_BOOKING_HEADER_DIAGNOSTIC_ENABLED: "true" },
    { VERCEL_ENV: "preview", GLOWFLOW_PUBLIC_BOOKING_HEADER_DIAGNOSTIC_ENABLED: "true", GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED: "true" },
  ];
  for (const values of denied) {
    // Disabled requests must not even read forwarding headers.
    const noHeaders = { get headers() { throw Error("headers accessed while disabled"); } };
    const response = withEnv(values, () => GET(noHeaders));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("enabled GET returns only four independent header-shape booleans", async () => {
  const fixtures = [
    [{}, [false, false, false, false]],
    [{ "x-forwarded-for": "192.0.2.7" }, [true, true, false, false]],
    [{ "x-forwarded-for": "192.0.2.7", "x-vercel-forwarded-for": "192.0.2.7" }, [true, true, true, false]],
    [{ "x-forwarded-for": "192.0.2.7", "x-vercel-forwarded-for": "192.0.2.8" }, [true, true, false, false]],
    [{ "x-forwarded-for": "192.0.2.7, 10.0.0.1", "x-vercel-forwarded-for": "192.0.2.7, 10.0.0.1" }, [true, false, true, false]],
    [{ "x-forwarded-for": "2001:0DB8:0:0:0:0:0:1", "x-vercel-forwarded-for": "2001:0DB8:0:0:0:0:0:1" }, [true, true, true, false]],
    [{ "x-forwarded-for": "unknown" }, [true, false, false, false]],
    [{ "x-forwarded-for": "203.0.113.77" }, [true, true, false, true]],
    [{ "x-forwarded-for": "203.0.113.77", "x-vercel-forwarded-for": "203.0.113.77" }, [true, true, true, true]],
  ];
  for (const [input, [has, valid, matches, sentinel]] of fixtures) {
    const response = enabledGet(input);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      has_forwarded_ip: has, single_valid_ip: valid, vercel_copy_matches: matches,
      forwarded_ip_matches_qa_sentinel: sentinel,
    });
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("sentinel comparison is fixed server-side and ignores URL candidates", async () => {
  const response = withEnv({ VERCEL_ENV: "preview", GLOWFLOW_PUBLIC_BOOKING_HEADER_DIAGNOSTIC_ENABLED: "true" },
    () => GET(new Request(`${endpoint}?candidate=192.0.2.7`, {
      headers: { "x-forwarded-for": "192.0.2.7", "x-vercel-forwarded-for": "192.0.2.7" },
    })));
  assert.equal((await response.json()).forwarded_ip_matches_qa_sentinel, false);
  for (const headers of [
    { "x-forwarded-for": "203.0.113.77" },
    { "x-forwarded-for": "203.0.113.77", "x-vercel-forwarded-for": "203.0.113.77" },
  ]) {
    const probe = enabledGet(headers);
    const body = await probe.text();
    assert.equal(JSON.parse(body).forwarded_ip_matches_qa_sentinel, true);
    assert.doesNotMatch(body + JSON.stringify(Object.fromEntries(probe.headers)), /203\.0\.113\.77/);
  }
});

test("diagnostic never returns or logs raw IP, cookie, token, or digest", async () => {
  const rawIp = "198.51.100.246";
  const rawCookie = "private-booking-capability-sentinel";
  const rawToken = "private-authorization-sentinel";
  const response = enabledGet({
    "x-forwarded-for": rawIp, "x-vercel-forwarded-for": rawIp,
    cookie: `booking=${rawCookie}`, authorization: `Bearer ${rawToken}`,
  });
  const body = await response.text();
  const allOutput = body + JSON.stringify(Object.fromEntries(response.headers));
  for (const sensitive of [rawIp, rawCookie, rawToken]) assert.doesNotMatch(allOutput, new RegExp(sensitive));
  assert.deepEqual(JSON.parse(body), {
    has_forwarded_ip: true, single_valid_ip: true, vercel_copy_matches: true,
    forwarded_ip_matches_qa_sentinel: false,
  });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.doesNotMatch(routeSource, /console\.|createAdminClient|supabase|\.rpc\(|\.fetch\(/i);
  assert.doesNotMatch(routeSource, /request\.cookies|request\.headers\.get/);
});

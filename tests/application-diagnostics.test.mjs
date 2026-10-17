import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

const compile = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64")}`;

const diagnosticSource = await readFile(new URL("../lib/application-diagnostics.ts", import.meta.url), "utf8");
const { reportApplicationFailure } = await import(compile(diagnosticSource));

test("application diagnostics use only allowlisted context and a generated correlation ID", () => {
  const logs = [];
  const original = console.error;
  console.error = (...values) => logs.push(values);
  try {
    const id = reportApplicationFailure("public_booking", "POST", "create", "database_error");
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(JSON.parse(logs[0][0]), {
      event: "glowflow_application_failure", request_id: id, route: "public_booking",
      method: "POST", stage: "create", code: "database_error",
    });

    const secrets = [
      "client@example.com", "+1-202-555-0123", "pi_private", "cs_test_private",
      "rk_test_private", "whsec_private", "Bearer private-token", "fullName: Secret Client",
    ];
    const hostile = { requestBody: secrets.join(" "), toJSON() { throw new Error(secrets.join(" ")); } };
    reportApplicationFailure(hostile, secrets[0], secrets[1], hostile);
    assert.deepEqual(JSON.parse(logs[1][0]), {
      event: "glowflow_application_failure", request_id: JSON.parse(logs[1][0]).request_id,
      route: "unknown", method: "unknown", stage: "unknown", code: "unexpected_error",
    });
    for (const secret of secrets) assert.ok(!logs[1][0].includes(secret), "diagnostic contains a sensitive fixture");

    console.error = () => { throw new Error("logger unavailable"); };
    assert.equal(reportApplicationFailure("public_booking", "GET", "availability", "database_error"), null);
  } finally {
    console.error = original;
  }
});

// Execute the route with real validation and mocked database boundaries. The mock's
// thrown values are intentionally hostile; only the fixed diagnostic object may log.
const mock = { result: { data: null, error: null }, throws: null };
globalThis.__glowflowObservabilityTest = { mock, z };
let routeSource = await readFile(new URL("../app/api/public-booking/route.ts", import.meta.url), "utf8");
routeSource = routeSource
  .replace('import { NextResponse } from "next/server";', 'const NextResponse = { json: Response.json };')
  .replace('import { z } from "zod";', 'const z = globalThis.__glowflowObservabilityTest.z;')
  .replace('import { reportApplicationFailure, type ApplicationCode, type ApplicationStage } from "@/lib/application-diagnostics";', `import { reportApplicationFailure } from "${compile(diagnosticSource)}";`)
  .replace('import { createAdminClient } from "@/lib/supabase/admin";',
    'const createAdminClient = () => ({ rpc: async () => { const state = globalThis.__glowflowObservabilityTest.mock; if (state.throws) throw state.throws; return state.result; } });');
const { GET, POST } = await import(compile(routeSource));

const booking = {
  salonSlug: "sample-salon", serviceId: "11111111-1111-4111-8111-111111111111",
  staffId: "22222222-2222-4222-8222-222222222222", startTime: "2030-06-15T14:00:00Z",
  fullName: "Secret Client", phone: "+1-202-555-0123", email: "client@example.com",
  locale: "en", requestKey: "33333333-3333-4333-8333-333333333333",
};

test("booking failures expose correlation IDs without logging PII or provider details", async () => {
  const logs = [];
  const original = console.error;
  console.error = line => logs.push(line);
  try {
    mock.result = { data: null, error: { code: "08006", message: "client@example.com rk_test_private pi_private" } };
    const post = await POST(new Request("https://example.test/api/public-booking?token=private-token", {
      method: "POST", body: JSON.stringify(booking),
    }));
    assert.equal(post.status, 500);
    assert.deepEqual(await post.json(), { error: "booking_failed" });
    const postEvent = JSON.parse(logs[0]);
    assert.equal(post.headers.get("x-glowflow-error-id"), postEvent.request_id);
    assert.equal(post.headers.get("cache-control"), "private, no-store");
    assert.deepEqual({ ...postEvent, request_id: null }, {
      event: "glowflow_application_failure", request_id: null, route: "public_booking",
      method: "POST", stage: "create", code: "database_error",
    });

    const get = await GET(new Request(`https://example.test/api/public-booking?salonSlug=sample-salon&serviceId=${booking.serviceId}&date=2030-06-15&token=private-token`));
    assert.equal(get.status, 500);
    assert.deepEqual(await get.json(), { error: "availability_failed" });
    assert.equal(get.headers.get("x-glowflow-error-id"), JSON.parse(logs[1]).request_id);

    mock.throws = new Error("whsec_private cs_test_private Bearer private-token");
    const thrown = await POST(new Request("https://example.test/api/public-booking", {
      method: "POST", body: JSON.stringify(booking),
    }));
    assert.equal(thrown.status, 500);
    assert.equal(JSON.parse(logs[2]).code, "unexpected_error");
    for (const line of logs) {
      for (const secret of [booking.fullName, booking.phone, booking.email, booking.requestKey,
        "rk_test_private", "pi_private", "whsec_private", "cs_test_private", "private-token"]) {
        assert.ok(!line.includes(secret), "route log contains a sensitive fixture");
      }
    }
  } finally {
    console.error = original;
    mock.throws = null;
  }
});

test("expected slot conflicts remain 409 without a failure event", async () => {
  const logs = [];
  const original = console.error;
  console.error = line => logs.push(line);
  try {
    mock.result = { data: null, error: { code: "23P01", message: "private@example.com" } };
    const response = await POST(new Request("https://example.test/api/public-booking", {
      method: "POST", body: JSON.stringify(booking),
    }));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "slot_unavailable" });
    assert.deepEqual(logs, []);
  } finally {
    console.error = original;
  }
});

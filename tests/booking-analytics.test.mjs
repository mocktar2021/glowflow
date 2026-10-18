import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
async function load(file, dependencies = {}) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", js)((name) => dependencies[name] ?? require(name), loaded.exports);
  return loaded.exports;
}

const { recordBookingOutcome } = await load("../lib/bookings/analytics.ts");
const fixture = {
  salonSlug: "private-salon", serviceId: "11111111-1111-4111-8111-111111111111",
  staffId: "22222222-2222-4222-8222-222222222222", startTime: "2030-06-15T14:00:00Z",
  fullName: "Secret Client", phone: "+1-202-555-0123", email: "private@example.invalid",
  locale: "en", requestKey: "33333333-3333-4333-8333-333333333333",
};
const sensitiveValues = Object.entries(fixture).filter(([key]) => key !== "locale").map(([, value]) => value);

test("booking count event has a fixed vocabulary and never serializes hostile inputs", () => {
  const lines = [];
  const original = console.info;
  const previousSetting = process.env.GLOWFLOW_BOOKING_COUNT_LOGS_ENABLED;
  console.info = line => lines.push(line);
  try {
    delete process.env.GLOWFLOW_BOOKING_COUNT_LOGS_ENABLED;
    recordBookingOutcome("confirmed");
    assert.deepEqual(lines, [], "telemetry is disabled by default");
    process.env.GLOWFLOW_BOOKING_COUNT_LOGS_ENABLED = "false";
    recordBookingOutcome("confirmed");
    assert.deepEqual(lines, [], "only an explicit true value activates telemetry");
    process.env.GLOWFLOW_BOOKING_COUNT_LOGS_ENABLED = "true";
    for (const outcome of ["confirmed", "slot_unavailable", "failed"]) recordBookingOutcome(outcome);
    const hostile = { toString() { throw Error(fixture.email); }, toJSON() { throw Error(fixture.fullName); } };
    recordBookingOutcome(hostile);
    recordBookingOutcome(fixture.email);
    assert.deepEqual(lines.map(JSON.parse), ["confirmed", "slot_unavailable", "failed"].map(outcome => ({
      event: "glowflow_booking_outcome_count", version: 1, outcome, count: 1,
    })));
    for (const line of lines) {
      for (const secret of sensitiveValues) assert.ok(!line.includes(secret), "metric contains request data");
    }
    console.info = () => { throw Error("logging unavailable"); };
    assert.doesNotThrow(() => recordBookingOutcome("confirmed"));
  } finally {
    console.info = original;
    if (previousSetting === undefined) delete process.env.GLOWFLOW_BOOKING_COUNT_LOGS_ENABLED;
    else process.env.GLOWFLOW_BOOKING_COUNT_LOGS_ENABLED = previousSetting;
  }
});

test("valid public-booking POSTs emit exactly one response outcome; GET and invalid POSTs emit none", async () => {
  const state = { result: null, thrown: null };
  const db = {
    async rpc() {
      if (state.thrown) throw state.thrown;
      return state.result;
    },
    from() { throw Error(`enrichment failed for ${fixture.email}`); },
  };
  const { POST, GET } = await load("../app/api/public-booking/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/application-diagnostics": { reportApplicationFailure: () => null },
    "@/lib/bookings/analytics": { recordBookingOutcome },
  });
  const lines = [];
  const original = console.info;
  const previousSetting = process.env.GLOWFLOW_BOOKING_COUNT_LOGS_ENABLED;
  console.info = line => lines.push(line);
  const post = body => POST(new Request("https://example.invalid/api/public-booking?token=private", {
    method: "POST", body: JSON.stringify(body),
  }));
  try {
    process.env.GLOWFLOW_BOOKING_COUNT_LOGS_ENABLED = "true";
    state.result = { data: [{ appointment_id: "private-appointment" }], error: null };
    assert.equal((await post(fixture)).status, 201);
    state.result = { data: null, error: { code: "23P01", message: fixture.email } };
    assert.equal((await post(fixture)).status, 409);
    state.result = { data: null, error: { code: "08006", message: fixture.phone } };
    assert.equal((await post(fixture)).status, 500);
    state.result = { data: null, error: null };
    assert.equal((await post(fixture)).status, 500);
    state.thrown = Error(fixture.fullName);
    assert.equal((await post(fixture)).status, 500);
    assert.equal((await post({ ...fixture, email: "bad-email" })).status, 400);
    assert.equal((await GET(new Request(`https://example.invalid/api/public-booking?salonSlug=${fixture.salonSlug}&serviceId=${fixture.serviceId}&date=2030-06-15`))).status, 500);
    assert.deepEqual(lines.map(line => JSON.parse(line).outcome), [
      "confirmed", "slot_unavailable", "failed", "failed", "failed",
    ]);
    for (const line of lines) {
      assert.deepEqual(Object.keys(JSON.parse(line)), ["event", "version", "outcome", "count"]);
      for (const secret of sensitiveValues) assert.ok(!line.includes(secret), "metric contains request data");
      assert.ok(!line.includes("private-appointment"));
    }
    console.info = () => { throw Error("logging unavailable"); };
    state.thrown = null;
    state.result = { data: [{ appointment_id: "private-appointment" }], error: null };
    assert.equal((await post(fixture)).status, 201, "metrics cannot fail a committed booking");
  } finally {
    console.info = original;
    if (previousSetting === undefined) delete process.env.GLOWFLOW_BOOKING_COUNT_LOGS_ENABLED;
    else process.env.GLOWFLOW_BOOKING_COUNT_LOGS_ENABLED = previousSetting;
  }
});

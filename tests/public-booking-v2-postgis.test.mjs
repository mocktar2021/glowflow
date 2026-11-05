import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { NextRequest } from "next/server.js";

// Production route function + real disposable PostGIS RPCs, via a test-only
// psql admin adapter. This is NOT browser, PostgREST, or Vercel end-to-end proof.
const connection = process.env.GLOWFLOW_ROUTE_POSTGIS_TEST_DATABASE_URL;
const root = new URL("../", import.meta.url);
const require = createRequire(import.meta.url);
const origin = "https://glowflow.invalid";
const endpoint = origin + "/api/public-booking/v2";
const cookieName = "__Host-glowflow_booking_session";
const salonSlug = "route-fixture";
const tenantId = "10000000-0000-0000-0000-000000000001";
const serviceId = "40000000-0000-0000-0000-000000000001";
const staffId = "20000000-0000-0000-0000-000000000002";
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function localConnection() {
  let url;
  try { url = new URL(connection); } catch { throw new Error("A disposable loopback PostgreSQL URL is required."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/glowflow_route_postgis_test_[0-9_]+$/.test(url.pathname)
    || url.search || url.hash) {
    throw new Error("Route-to-PostGIS tests require a fresh loopback glowflow_route_postgis_test_* database.");
  }
  return url;
}

function psql(input, variables = {}) {
  const args = ["-X", "-w", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", connection];
  for (const [name, value] of Object.entries(variables)) args.push("-v", name + "=" + value);
  return spawnSync(process.env.PSQL_BIN || "psql", args, {
    input, encoding: "utf8", timeout: 90_000, maxBuffer: 2 * 1024 * 1024,
  });
}

function sql(input, step) {
  const result = psql(input);
  if (result.status !== 0) throw new Error("Disposable PostgreSQL step failed: " + step);
  return result.stdout.trim().split("\n").at(-1);
}

function load(file, dependencies = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", js)((name) => dependencies[name] ?? require(name), loaded.exports);
  return loaded.exports;
}

const rpcSpecs = Object.freeze({
  consume_public_booking_quota: {
    columns: "quota_action text, ip_digest text, browser_digest text, salon_slug text",
    arguments: "quota_action, ip_digest, browser_digest, salon_slug",
  },
  consume_public_booking_capability_quota: {
    columns: "quota_action text, browser_digest text, intent_digest text, salon_slug text",
    arguments: "quota_action, browser_digest, intent_digest, salon_slug",
  },
  prepare_public_booking_intent: {
    columns: "salon_slug text, browser_token_hash text, service_id uuid, staff_id uuid, requested_start timestamptz, client_full_name text, client_phone text, client_email text, client_locale text, expected_generation uuid",
    arguments: "salon_slug, browser_token_hash, service_id, staff_id, requested_start, client_full_name, client_phone, client_email, client_locale, expected_generation",
  },
  reconcile_public_booking_intent: {
    columns: "salon_slug text, browser_token_hash text, intent_id uuid",
    arguments: "salon_slug, browser_token_hash, intent_id",
  },
  commit_public_booking_intent: {
    columns: "salon_slug text, browser_token_hash text, intent_id uuid",
    arguments: "salon_slug, browser_token_hash, intent_id",
  },
  cancel_public_booking_intent: {
    columns: "salon_slug text, browser_token_hash text, intent_id uuid",
    arguments: "salon_slug, browser_token_hash, intent_id",
  },
  acknowledge_public_booking_intent: {
    columns: "salon_slug text, browser_token_hash text, intent_id uuid",
    arguments: "salon_slug, browser_token_hash, intent_id",
  },
});

function routeWithPostgres() {
  const rpcFailures = [];
  const quotaCalls = [];
  const admin = { createAdminClient: () => ({
    // Optional confirmation enrichment is intentionally not emulated. The
    // route catches this and returns its safe no-details confirmation.
    from() { throw new Error("Test adapter does not emulate PostgREST reads."); },
    async rpc(name, values) {
      const spec = Object.hasOwn(rpcSpecs, name) ? rpcSpecs[name] : null;
      if (!spec) throw new Error("Unexpected route RPC name.");
      if (name.startsWith("consume_public_booking_")) quotaCalls.push(name + ":" + values.quota_action);
      const query = "set role service_role;\nselect public." + name
        + "(" + spec.arguments + ") from jsonb_to_record(:'payload'::jsonb) as input("
        + spec.columns + ");";
      const result = psql(query, { payload: JSON.stringify(values) });
      if (result.status !== 0) {
        rpcFailures.push(name);
        return { data: null, error: { message: "Disposable RPC failed." } };
      }
      try {
        return { data: JSON.parse(result.stdout.trim().split("\n").at(-1)), error: null };
      } catch {
        rpcFailures.push(name);
        return { data: null, error: { message: "Disposable RPC returned invalid JSON." } };
      }
    },
  }) };
  const quotaKeys = load("../lib/public-booking-quota-keys.ts", { "server-only": {} });
  const config = load("../lib/public-booking-v2-config.ts");
  const { POST } = load("../app/api/public-booking/v2/route.ts", {
    "@/lib/public-booking-quota-keys": quotaKeys,
    "@/lib/public-booking-v2-config": config,
    "@/lib/supabase/admin": admin,
  });
  return { POST, rpcFailures, quotaCalls };
}

async function post(POST, body, cookie) {
  const headers = {
    origin, "content-type": "application/json", "sec-fetch-site": "same-origin",
    // Synthetic CI-only stand-in; this does not validate Vercel header trust.
    "x-forwarded-for": "192.0.2.10", "x-vercel-forwarded-for": "192.0.2.10",
  };
  if (cookie) headers.cookie = cookie;
  const response = await POST(new NextRequest(endpoint, {
    method: "POST", headers, body: JSON.stringify(body),
  }));
  return { response, data: await response.json() };
}

test("production v2 route reaches real disposable PostGIS quota and intent RPCs", {
  skip: !connection, timeout: 180_000,
}, async () => {
  localConnection(); // Validate before the first database command.
  assert.equal(sql("select count(*) from pg_namespace where nspname not in ('public','information_schema') and nspname !~ '^pg_'", "empty user schemas"), "0");
  // PostGIS images may include the extension-owned spatial_ref_sys table.
  assert.equal(sql("select count(*) from pg_tables where schemaname='public' and tablename <> 'spatial_ref_sys'", "empty application schema"), "0");
  sql(readFileSync(new URL("tests/supabase-platform-fixture.sql", root), "utf8"), "platform fixture");
  sql(readFileSync(new URL("supabase/schema.sql", root), "utf8"), "baseline schema");
  for (const migration of readdirSync(new URL("supabase/migrations/", root)).filter(name => name.endsWith(".sql")).sort()) {
    sql(readFileSync(new URL("supabase/migrations/" + migration, root), "utf8"), migration);
  }
  sql(readFileSync(new URL("tests/public-booking-v2-postgis-fixture.sql", root), "utf8"), "fictional route fixture");

  const slots = JSON.parse(sql(
    "set role service_role; select coalesce(jsonb_agg(jsonb_build_object('start', slot_start, 'staff', staff_id) order by slot_start), '[]'::jsonb) from (select slot_start, staff_id from public.get_public_booking_slots('route-fixture','40000000-0000-0000-0000-000000000001', current_date + (8 - extract(dow from current_date)::integer)) where staff_id='20000000-0000-0000-0000-000000000002' order by slot_start limit 5) as future_slots;",
    "valid future slots"));
  assert.ok(slots.length >= 5, "The disposable fixture must expose five future staff slots.");
  assert.equal(slots[0].staff, staffId);
  assert.equal(slots[4].staff, staffId);

  const priorEnv = Object.fromEntries([
    "VERCEL_ENV", "GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED",
    "GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS",
    "GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY",
    "GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY",
  ].map(name => [name, process.env[name]]));
  try {
    process.env.VERCEL_ENV = "preview";
    process.env.GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED = "true";
    process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS = "3600";
    process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY = Buffer.alloc(32, 17).toString("base64url");
    process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY = Buffer.alloc(32, 29).toString("base64url");
    const { POST, rpcFailures, quotaCalls } = routeWithPostgres();

    const boot = await post(POST, { action: "bootstrap" });
    assert.equal(boot.response.status, 200, JSON.stringify(rpcFailures));
    assert.deepEqual(boot.data, { ready: true, new_session: true });
    const cookie = boot.response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie?.startsWith(cookieName + "=v1."), "Bootstrap must issue a signed test cookie.");
    const rawToken = cookie.slice(cookieName.length + 1);
    const browserHash = createHash("sha256").update(rawToken).digest("hex");

    const current = await post(POST, { action: "reconcile", salonSlug }, cookie);
    assert.equal(current.response.status, 200, JSON.stringify(rpcFailures));
    assert.equal(current.data.state, "none");
    assert.match(current.data.generation, uuidPattern);

    const prepared = await post(POST, {
      action: "prepare", salonSlug, serviceId, staffId, startTime: slots[0].start,
      fullName: "Fictional Route Client", phone: "", email: "route-client@example.invalid",
      locale: "en", expectedGeneration: current.data.generation,
    }, cookie);
    assert.equal(prepared.response.status, 200, JSON.stringify(rpcFailures));
    assert.equal(prepared.data.state, "prepared");
    assert.match(prepared.data.intent_id, uuidPattern);
    assert.equal(sql("select count(*) from private.public_booking_intents where browser_token_hash='"
      + browserHash + "'", "browser-bound intent"), "1");

    const committed = await post(POST, {
      action: "commit", salonSlug, intentId: prepared.data.intent_id,
    }, cookie);
    assert.equal(committed.response.status, 200, JSON.stringify(rpcFailures));
    assert.equal(committed.data.state, "confirmed");
    assert.equal(committed.data.intent_id, prepared.data.intent_id);
    assert.match(committed.data.confirmation.appointment_id, uuidPattern);
    assert.equal(committed.data.confirmation.saved_locale, "en");
    assert.doesNotMatch(JSON.stringify(committed.data), /Fictional Route Client|route-client@example.invalid/);
    assert.equal(sql("select count(*) from public.appointments where tenant_id='"
      + tenantId + "'", "one committed appointment"), "1");
    assert.equal(sql("select id from public.appointments where tenant_id='"
      + tenantId + "'", "committed appointment ID"), committed.data.confirmation.appointment_id);

    const recovered = await post(POST, {
      action: "reconcile", salonSlug, intentId: prepared.data.intent_id,
    }, cookie);
    assert.equal(recovered.response.status, 200, JSON.stringify(rpcFailures));
    assert.equal(recovered.data.state, "confirmed");
    assert.equal(recovered.data.confirmation.appointment_id, committed.data.confirmation.appointment_id);
    const replay = await post(POST, {
      action: "commit", salonSlug, intentId: prepared.data.intent_id,
    }, cookie);
    assert.equal(replay.response.status, 200, JSON.stringify(rpcFailures));
    assert.equal(replay.data.confirmation.appointment_id, committed.data.confirmation.appointment_id);
    assert.equal(sql("select count(*) from public.appointments where tenant_id='"
      + tenantId + "'", "idempotent commit"), "1");

    const acknowledged = await post(POST, {
      action: "acknowledge", salonSlug, intentId: prepared.data.intent_id,
    }, cookie);
    assert.equal(acknowledged.response.status, 200, JSON.stringify(rpcFailures));
    assert.equal(acknowledged.data.state, "none");
    const afterAck = await post(POST, { action: "reconcile", salonSlug }, cookie);
    assert.equal(afterAck.data.state, "none");
    assert.equal(afterAck.data.generation, acknowledged.data.generation);

    sql("update private.public_booking_quota_policy set ip_limit=1 where action_bucket='prepare'", "temporary quota limit");
    const quotaHitsBefore = sql("select coalesce(sum(hits),0) from private.public_booking_quota_counters where action_bucket='prepare'", "quota counter before denial");
    const denied = await post(POST, {
      action: "prepare", salonSlug, serviceId, staffId, startTime: slots[4].start,
      fullName: "Fictional Route Client", phone: "", email: "route-client@example.invalid",
      locale: "en", expectedGeneration: afterAck.data.generation,
    }, cookie);
    assert.equal(denied.response.status, 429);
    assert.deepEqual(denied.data, { state: "unknown", error: "rate_limited" });
    assert.match(denied.response.headers.get("retry-after"), /^[1-9][0-9]*$/);
    assert.equal(sql("select coalesce(sum(hits),0) from private.public_booking_quota_counters where action_bucket='prepare'", "quota counter after denial"), quotaHitsBefore);
    assert.equal(sql("select count(*) from private.public_booking_intents where browser_token_hash='"
      + browserHash + "'", "denied prepare did not add intent"), "1");
    assert.equal(sql("select count(*) from public.appointments where tenant_id='"
      + tenantId + "'", "denied prepare did not book"), "1");
    sql("update private.public_booking_quota_policy set ip_limit=100 where action_bucket='prepare'", "restore disposable quota limit");

    const second = await post(POST, {
      action: "prepare", salonSlug, serviceId, staffId, startTime: slots[4].start,
      fullName: "Fictional Route Client", phone: "", email: "route-client@example.invalid",
      locale: "en", expectedGeneration: afterAck.data.generation,
    }, cookie);
    assert.equal(second.response.status, 200, JSON.stringify(rpcFailures));
    assert.equal(second.data.state, "prepared");
    assert.notEqual(second.data.intent_id, prepared.data.intent_id);
    const canceled = await post(POST, {
      action: "cancel", salonSlug, intentId: second.data.intent_id,
    }, cookie);
    assert.equal(canceled.response.status, 200, JSON.stringify(rpcFailures));
    assert.equal(canceled.data.state, "not_committed");
    const cancelReconcile = await post(POST, {
      action: "reconcile", salonSlug, intentId: second.data.intent_id,
    }, cookie);
    assert.equal(cancelReconcile.data.state, "not_committed");
    const fencedCommit = await post(POST, {
      action: "commit", salonSlug, intentId: second.data.intent_id,
    }, cookie);
    assert.equal(fencedCommit.data.state, "not_committed");
    assert.equal(sql("select count(*) from public.appointments where tenant_id='"
      + tenantId + "'", "canceled intent cannot book"), "1");
    assert.equal(quotaCalls.filter(name => name === "consume_public_booking_quota:bootstrap").length, 1);
    assert.equal(quotaCalls.filter(name => name === "consume_public_booking_quota:prepare").length, 3);
    assert.equal(quotaCalls.filter(name => name === "consume_public_booking_quota:reconcile").length, 4);
    assert.equal(quotaCalls.filter(name => name === "consume_public_booking_capability_quota:commit").length, 3);
    assert.equal(quotaCalls.filter(name => name === "consume_public_booking_capability_quota:cancel").length, 1);
    assert.equal(quotaCalls.filter(name => name === "consume_public_booking_capability_quota:acknowledge").length, 1);
    assert.equal(quotaCalls.length, 13);
    assert.deepEqual(rpcFailures, []);
  } finally {
    for (const [name, value] of Object.entries(priorEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

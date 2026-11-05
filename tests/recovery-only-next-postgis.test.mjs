import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Actual local Next HTTP routes + test-only psql adapter + disposable PostGIS.
// The SQL gate is NON-MIGRATION and must never be applied to hosted Supabase.
const connection = process.env.GLOWFLOW_ROUTE_POSTGIS_TEST_DATABASE_URL;
const runnerNonce = process.env.GLOWFLOW_RECOVERY_ONLY_RUNNER_NONCE;
const slotInput = process.env.GLOWFLOW_RECOVERY_ONLY_SLOTS;
const tenant = "10000000-0000-0000-0000-000000000001";
const service = "40000000-0000-0000-0000-000000000001";
const staff = "20000000-0000-0000-0000-000000000002";
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = resolve(root, "tests/browser/fixture");

function checkedDatabase() {
  let url;
  try { url = new URL(connection); } catch { throw new Error("Use the disposable recovery-only runner."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^\/glowflow_route_postgis_test_[0-9_]+$/.test(url.pathname)
    || url.search || url.hash) throw new Error("Only a generated loopback PostgreSQL database is allowed.");
  return connection;
}
function psql(query) {
  return spawnSync(process.env.PSQL_BIN || "psql", ["-X", "-w", "-q", "-At",
    "-v", "ON_ERROR_STOP=1", "-d", checkedDatabase()],
  { input: query, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
}
function sql(query) {
  const result = psql(query);
  if (result.status !== 0) throw new Error("Disposable PostgreSQL assertion failed.");
  return result.stdout.trim().split("\n").at(-1);
}
function state(query) { return JSON.parse(sql(query)); }
function asService(query) { return `set role service_role; ${query}`; }
function cookie(host, key) {
  const issued = Math.floor(Date.now() / 1000);
  const payload = `v1.${issued}.${issued + 3600}.${randomBytes(32).toString("base64url")}`;
  const signature = createHmac("sha256", key).update(host).update("\0").update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function hash(token) { return createHash("sha256").update(token).digest("hex"); }
function prepare(browserHash, start, generation, address) {
  return state(asService(`select public.prepare_public_booking_intent(
    'route-fixture','${browserHash}','${service}','${staff}','${start}'::timestamptz,
    'Fictional Recovery Client',null,'${address}','en','${generation}'::uuid)`));
}
function counts() {
  return {
    sessions: sql(`select count(*) from private.public_booking_browser_sessions where tenant_id='${tenant}'`),
    intents: sql(`select count(*) from private.public_booking_intents where tenant_id='${tenant}'`),
    appointments: sql(`select count(*) from public.appointments where tenant_id='${tenant}'`),
  };
}
function quotaHits() { return sql("select coalesce(sum(hits),0) from private.public_booking_quota_counters"); }

test("recovery-only local Next routes drain exact signed intents without new booking admission", {
  skip: !connection && !runnerNonce && !slotInput, timeout: 300_000,
}, async () => {
  if (!connection || !runnerNonce || !slotInput) throw new Error("Direct invocation is unsupported.");
  checkedDatabase();
  assert.match(runnerNonce, /^[0-9a-f]{64}$/);
  assert.equal(sql("select nonce from private.glowflow_recovery_only_runner_marker where singleton"), runnerNonce);
  const slots = JSON.parse(slotInput);
  assert.equal(slots.length, 3);
  for (const start of slots) assert.match(start, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(new Set(slots).size, 3);
  assert.equal(sql("select mode from private.public_booking_contract_gate where singleton"), "v2");
  assert.deepEqual(counts(), { sessions: "0", intents: "0", appointments: "0" });

  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const origin = `http://localhost:${port}`;
  const key = Buffer.from(process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY, "base64url");
  assert.equal(key.length, 32);
  const [first, second, empty, unseeded] = Array.from({ length: 4 }, () => cookie(`localhost:${port}`, key));
  const [firstHash, secondHash, emptyHash, unseededHash] = [first, second, empty, unseeded].map(hash);
  const firstGeneration = state(asService(`select public.reconcile_public_booking_intent('route-fixture','${firstHash}',null)`)).generation;
  const secondGeneration = state(asService(`select public.reconcile_public_booking_intent('route-fixture','${secondHash}',null)`)).generation;
  const emptyGeneration = state(asService(`select public.reconcile_public_booking_intent('route-fixture','${emptyHash}',null)`)).generation;
  const firstIntent = prepare(firstHash, slots[0], firstGeneration, "first@example.invalid");
  const secondIntent = prepare(secondHash, slots[1], secondGeneration, "second@example.invalid");
  assert.equal(firstIntent.state, "prepared");
  assert.equal(secondIntent.state, "prepared");
  assert.deepEqual(counts(), { sessions: "3", intents: "2", appointments: "0" });

  assert.equal(sql("select private.transition_public_booking_mode('v2','v2_no_prepares')"), "v2_no_prepares");
  assert.equal(sql("select mode from private.public_booking_contract_gate where singleton"), "v2_no_prepares");
  const baseline = counts();
  const baselineQuota = quotaHits();
  const deniedPrepare = psql(asService(`select public.prepare_public_booking_intent(
    'route-fixture','${emptyHash}','${service}','${staff}','${slots[2]}'::timestamptz,
    'Fictional Recovery Client',null,'third@example.invalid','en','${emptyGeneration}'::uuid)`));
  assert.notEqual(deniedPrepare.status, 0);
  assert.match(deniedPrepare.stderr, /booking_contract_closed/);
  assert.equal(state(asService(`select public.reconcile_public_booking_intent('route-fixture','${unseededHash}',null)`)).state, "unknown");
  assert.deepEqual(counts(), baseline, "SQL gate must not insert a session or intent in recovery-only mode.");

  // Whitelist local-only inputs. Feature flags remain OFF by default outside
  // this disposable child process; no hosted Supabase credentials are inherited.
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, CI: process.env.CI,
    NEXT_TELEMETRY_DISABLED: "1", VERCEL_ENV: "preview",
    GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED: "true",
    GLOWFLOW_PUBLIC_BOOKING_V2_RECOVERY_ONLY: "true",
    GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY: process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY,
    GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY: process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY,
    GLOWFLOW_ROUTE_POSTGIS_TEST_DATABASE_URL: connection, PSQL_BIN: process.env.PSQL_BIN,
  };
  const server = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"),
    "dev", "--webpack", "--hostname", "localhost", "--port", String(port)],
  { cwd: fixture, env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)),
    stdio: ["ignore", "pipe", "pipe"] });
  const serverClosed = new Promise(resolve => server.once("close", resolve));
  let serverOutput = "";
  server.stdout.on("data", value => { serverOutput = (serverOutput + value).slice(-4096); });
  server.stderr.on("data", value => { serverOutput = (serverOutput + value).slice(-4096); });
  try {
    const deadline = Date.now() + 120_000;
    while (true) {
      if (server.exitCode !== null) throw new Error("Local Next fixture exited before readiness.");
      try { if ((await fetch(origin, { signal: AbortSignal.timeout(10_000) })).ok) break; }
      catch { /* Next is still starting. */ }
      if (Date.now() > deadline) throw new Error("Local Next fixture did not become ready.");
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const post = async (path, body, token) => {
      const response = await fetch(origin + path, { method: "POST", headers: {
        origin, "content-type": "application/json", "sec-fetch-site": "same-origin",
        "x-forwarded-for": "192.0.2.10",
        ...(token ? { cookie: `__Host-glowflow_booking_session=${token}` } : {}),
      }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      return { status: response.status, data: await response.json(), setCookie: response.headers.get("set-cookie") };
    };
    const v2 = "/api/public-booking/v2";
    const noCookie = await post(v2, { action: "bootstrap" });
    assert.equal(noCookie.status, 409);
    assert.equal(noCookie.setCookie, null);
    const signedNoSession = await post(v2, { action: "bootstrap" }, unseeded);
    assert.equal(signedNoSession.status, 200);
    assert.deepEqual(signedNoSession.data, { ready: true, new_session: false, admission: "recovery_only" });
    assert.equal(signedNoSession.setCookie, null);
    assert.deepEqual(counts(), baseline, "Signed bootstrap must not create an unknown session.");
    const noId = await post(v2, { action: "reconcile", salonSlug: "route-fixture" }, unseeded);
    assert.equal(noId.status, 503);
    assert.equal(noId.data.error, "booking_paused");
    assert.equal(noId.setCookie, null);
    const newPrepare = await post(v2, {
      action: "prepare", salonSlug: "route-fixture", serviceId: service, staffId: staff,
      startTime: slots[2], fullName: "Fictional Recovery Client", phone: "",
      email: "third@example.invalid", locale: "en", expectedGeneration: emptyGeneration,
    }, empty);
    assert.equal(newPrepare.status, 503);
    assert.equal(newPrepare.data.error, "booking_paused");
    assert.equal(newPrepare.setCookie, null);
    assert.deepEqual(counts(), baseline, "HTTP recovery mode must not create a session, intent or appointment.");
    assert.equal(quotaHits(), baselineQuota, "Pre-RPC denials must not consume quota.");
    const legacy = await post("/api/public-booking", { action: "create" });
    assert.equal(legacy.status, 410);
    assert.equal(legacy.data.error, "booking_contract_changed");

    const firstRecovered = await post(v2, { action: "reconcile", salonSlug: "route-fixture", intentId: firstIntent.intent_id }, first);
    assert.equal(firstRecovered.status, 200);
    assert.equal(firstRecovered.data.state, "prepared");
    assert.equal(firstRecovered.data.intent_id, firstIntent.intent_id);
    const committed = await post(v2, { action: "commit", salonSlug: "route-fixture", intentId: firstIntent.intent_id }, first);
    assert.equal(committed.status, 200);
    assert.equal(committed.data.state, "confirmed");
    assert.equal(committed.data.intent_id, firstIntent.intent_id);
    assert.equal(counts().appointments, "1");
    assert.equal(sql(`select id from public.appointments where tenant_id='${tenant}'`),
      committed.data.confirmation.appointment_id, "The only appointment must be the recovered original.");
    assert.equal((await post(v2, { action: "reconcile", salonSlug: "route-fixture", intentId: firstIntent.intent_id }, first)).data.confirmation.appointment_id,
      committed.data.confirmation.appointment_id);
    const secondRecovered = await post(v2, { action: "reconcile", salonSlug: "route-fixture", intentId: secondIntent.intent_id }, second);
    assert.equal(secondRecovered.status, 200);
    assert.equal(secondRecovered.data.state, "prepared");
    const canceled = await post(v2, { action: "cancel", salonSlug: "route-fixture", intentId: secondIntent.intent_id }, second);
    assert.equal(canceled.status, 200);
    assert.equal(canceled.data.state, "not_committed");
    assert.equal((await post(v2, { action: "commit", salonSlug: "route-fixture", intentId: secondIntent.intent_id }, second)).data.state,
      "not_committed");
    assert.deepEqual(counts(), { sessions: "3", intents: "2", appointments: "1" });
  } finally {
    if (server.exitCode === null) server.kill("SIGTERM");
    const killTimer = setTimeout(() => server.kill("SIGKILL"), 5_000);
    try { await serverClosed; } finally { clearTimeout(killTimer); }
    void serverOutput; // Never print raw local server diagnostics or contact data.
  }
});

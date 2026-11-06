import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Browser -> actual local Next route -> real disposable PostgreSQL RPCs.
// Not a PostgREST, Vercel-header, or hosted Supabase end-to-end test.
const database = process.env.GLOWFLOW_ROUTE_POSTGIS_TEST_DATABASE_URL;
const slotInput = process.env.GLOWFLOW_BROWSER_POSTGIS_SLOT;
const runnerNonce = process.env.GLOWFLOW_BROWSER_POSTGIS_RUNNER_NONCE;
const scenario = process.env.GLOWFLOW_BROWSER_POSTGIS_SCENARIO;
const recoveryOnly = scenario === "recovery_only" || scenario === "recovery_only_noncommitted";
const nonCommitted = scenario === "recovery_only_noncommitted";
const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = resolve(root, "tests/browser/fixture");

function checkedDatabaseUrl() {
  let url;
  try { url = new URL(database); } catch { throw new Error("Disposable loopback PostgreSQL URL required."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^\/glowflow_route_postgis_test_[0-9_]+$/.test(url.pathname)
    || url.search || url.hash) throw new Error("Only a generated loopback PostgreSQL database is allowed.");
  return database;
}

function scalar(query) {
  const result = spawnSync(process.env.PSQL_BIN || "psql", [
    "-X", "-w", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", checkedDatabaseUrl(),
  ], { input: query, encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0) throw new Error("Disposable PostgreSQL assertion failed.");
  return result.stdout.trim().split("\n").at(-1);
}

test(nonCommitted
  ? "browser keeps a real prepared intent locked after an uncommitted response is lost at cutover"
  : recoveryOnly
    ? "browser recovers a lost real booking after v2 closes to recovery-only"
    : "browser recovers one real local v2 booking after its committed response is lost", {
  skip: !database && !slotInput && !runnerNonce, timeout: 300_000,
}, async () => {
  if (!database || !slotInput || !runnerNonce) throw new Error("Use the disposable browser-PostGIS runner; direct invocation is unsupported.");
  checkedDatabaseUrl();
  assert.match(runnerNonce, /^[0-9a-f]{64}$/);
  assert.equal(scalar("select nonce from private.glowflow_browser_postgis_runner_marker where singleton"), runnerNonce,
    "The browser test must be issued by this disposable database runner.");
  const slot = JSON.parse(slotInput);
  assert.match(slot.start, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(slot.alternateStart, /^\d{4}-\d{2}-\d{2}T/);
  assert.notEqual(slot.start, slot.alternateStart);
  assert.match(slot.localDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(scalar("select count(*) from public.appointments where tenant_id='10000000-0000-0000-0000-000000000001'"), "0");

  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const origin = `http://localhost:${port}`;
  // Whitelist only local fixture values. No hosted Supabase, payment, or app secrets.
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, CI: process.env.CI,
    NEXT_TELEMETRY_DISABLED: "1", VERCEL_ENV: "preview",
    GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED: "true",
    GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS: "3600",
    GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY: process.env.GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY,
    GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY: process.env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY,
    GLOWFLOW_ROUTE_POSTGIS_TEST_DATABASE_URL: database,
    PSQL_BIN: process.env.PSQL_BIN,
  };
  let serverOutput = "";
  function startServer(recoveryMode) {
    const server = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"),
      "dev", "--webpack", "--hostname", "localhost", "--port", String(port)],
    { cwd: fixture, env: Object.fromEntries(Object.entries({ ...env,
      ...(recoveryMode ? { GLOWFLOW_PUBLIC_BOOKING_V2_RECOVERY_ONLY: "true" } : {}),
    }).filter(([, value]) => value !== undefined)), stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", value => { serverOutput = (serverOutput + value).slice(-4096); });
    server.stderr.on("data", value => { serverOutput = (serverOutput + value).slice(-4096); });
    return { server, closed: new Promise(resolve => server.once("close", resolve)) };
  }
  async function waitForServer(active) {
    const deadline = Date.now() + 120_000;
    while (true) {
      if (active.server.exitCode !== null) throw new Error("Local Next fixture exited before readiness.");
      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
        if (response.ok) break;
      } catch { /* Next is still starting. */ }
      if (Date.now() > deadline) throw new Error("Local Next fixture did not become ready.");
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  async function stopServer(active) {
    if (active.server.exitCode === null) active.server.kill("SIGTERM");
    const killTimer = setTimeout(() => active.server.kill("SIGKILL"), 5_000);
    try { await active.closed; } finally { clearTimeout(killTimer); }
  }
  let active = startServer(false);
  let browser;
  try {
    await waitForServer(active);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { "x-forwarded-for": "192.0.2.10" } });
    let page = await context.newPage();
    page.setDefaultTimeout(45_000);
    const actions = [];
    const exactReconciles = [];
    const errors = [];
    let legacyPosts = 0;
    let lostCommit = false;
    let committedId = null;
    let resolveCommitHandled;
    const commitHandled = new Promise(resolve => { resolveCommitHandled = resolve; });
    page.on("pageerror", () => errors.push("browser runtime error"));
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/api/public-booking" && route.request().method() === "GET") {
        const match = url.searchParams.get("salonSlug") === "route-fixture"
          && url.searchParams.get("serviceId") === "40000000-0000-0000-0000-000000000001"
          && url.searchParams.get("date") === slot.localDate;
        return route.fulfill({ json: { slots: match ? [slot.start, slot.alternateStart].map(start => ({
          slot_start: start, staff_id: "20000000-0000-0000-0000-000000000002",
        })) : [] } });
      }
      if (url.pathname === "/api/public-booking" && route.request().method() === "POST") {
        legacyPosts += 1;
        return route.abort(); // Never allow an unexpected legacy write, even on disposable PostGIS.
      }
      if (url.pathname === "/api/public-booking/v2") {
        const payload = route.request().postDataJSON();
        const action = payload.action;
        actions.push(action); // Never retain contact details or the signed cookie.
        if (action === "reconcile" && payload.intentId) exactReconciles.push(payload.intentId);
        if (action === "commit" && !lostCommit) {
          if (nonCommitted) {
            lostCommit = true;
            resolveCommitHandled();
            return route.abort("failed"); // The request never reaches Next or PostgreSQL.
          }
          const committed = await route.fetch(); // Server and PostgreSQL finish first.
          const body = await committed.json();
          assert.equal(committed.status(), 200);
          assert.equal(body.state, "confirmed");
          committedId = body.confirmation.appointment_id;
          lostCommit = true;
          resolveCommitHandled();
          return route.abort("failed"); // Only the browser loses the response.
        }
      }
      return route.continue();
    });

    await page.goto(`${origin}/en/book/route-fixture?realV2=1`);
    await page.locator('[name="bookingService"]:not([disabled])').waitFor();
    let cookies = [];
    const cookieDeadline = Date.now() + 30_000;
    while (Date.now() < cookieDeadline) {
      cookies = await context.cookies(origin);
      if (cookies.some(cookie => cookie.name === "__Host-glowflow_booking_session")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(cookies.filter(cookie => cookie.name === "__Host-glowflow_booking_session"
      && cookie.httpOnly && cookie.secure).length, 1,
    "The actual signed Secure HttpOnly browser cookie must persist.");
    await page.locator('input[type="date"]').fill(slot.localDate);
    const radio = page.locator(`[name="bookingTime"][value="${slot.start}"]`);
    await radio.waitFor();
    assert.equal(await page.locator('[name="bookingTime"]').count(), 2,
      "The fixture must offer an alternate real slot before booking.");
    await radio.locator("..").click();
    await page.locator('[name="fullName"]').fill("Fictional Browser Client");
    await page.locator('[name="email"]').fill("browser-postgis@example.invalid");
    await page.getByRole("button", { name: "Confirm appointment", exact: true }).click();
    let commitTimeout;
    try {
      await Promise.race([commitHandled, new Promise((_, reject) => {
        commitTimeout = setTimeout(() => reject(new Error("Local committed response was not observed.")), 45_000);
      })]);
    } finally { clearTimeout(commitTimeout); }
    await page.getByRole("button", { name: "Check original request" }).waitFor();
    assert.equal(lostCommit, true);
    if (!nonCommitted) assert.match(committedId, /^[0-9a-f-]{36}$/);
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0,
      "A lost response must hide the alternate time choice.");
    assert.equal(await page.getByRole("button", { name: "Confirm appointment", exact: true }).count(), 0);
    const beforeForcedSubmit = actions.length;
    await page.locator("form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(actions.length, beforeForcedSubmit, "A forced submit cannot prepare or commit another booking.");
    assert.equal(scalar("select count(*) from public.appointments where tenant_id='10000000-0000-0000-0000-000000000001'"), nonCommitted ? "0" : "1");
    const savedIntentId = scalar("select id from private.public_booking_intents where tenant_id='10000000-0000-0000-0000-000000000001'");
    if (nonCommitted) assert.equal(scalar(`select state from private.public_booking_intents where id='${savedIntentId}'`), "prepared");
    if (recoveryOnly) {
      const browserCookie = cookies.find(cookie => cookie.name === "__Host-glowflow_booking_session").value;
      assert.deepEqual(await page.evaluate(() => Object.entries(localStorage)
        .filter(([key]) => key.startsWith("glowflow.booking.pending.route-fixture."))),
      [[`glowflow.booking.pending.route-fixture.${savedIntentId}`, "1"]],
      "The uncertain booking must retain only its exact local intent marker.");
      const beforeCutover = actions.length;
      assert.equal(scalar("select private.transition_public_booking_mode('v2','v2_no_prepares')"), "v2_no_prepares");
      await page.close(); // Avoid a Next dev Fast Refresh race while retaining browser-context storage.
      await stopServer(active);
      active = startServer(true);
      await waitForServer(active);
      page = await context.newPage();
      page.setDefaultTimeout(45_000);
      page.on("pageerror", () => errors.push("browser runtime error"));
      await page.goto(`${origin}/en/book/route-fixture?realV2=1&recoveryOnly=1`);
      if (nonCommitted) {
        await page.getByRole("alert").filter({ hasText: "This request is still pending" }).waitFor();
      } else {
        await page.getByRole("heading", { name: "Appointment confirmed", exact: true }).waitFor();
      }
      assert.deepEqual(actions.slice(beforeCutover), ["bootstrap", "reconcile"],
        "Recovery-only reload must check the exact intent without a new session, prepare, or commit.");
      assert.equal((await context.cookies(origin)).find(cookie => cookie.name === "__Host-glowflow_booking_session")?.value,
        browserCookie, "Recovery-only reload must preserve the original host-bound cookie.");
      assert.equal(scalar("select count(*) from private.public_booking_browser_sessions"), "1");
      assert.equal(scalar("select count(*) from private.public_booking_intents"), "1");
      assert.equal(await page.getByRole("button", { name: "Book another appointment" }).count(), 0);
      assert.equal(await page.locator('[name="bookingTime"]').count(), 0,
        "Recovery-only mode must not reveal the alternate slot.");
      if (nonCommitted) {
        assert.equal(await page.getByRole("button", { name: "Finish the original booking" }).count(), 0,
          "A reloaded tab cannot silently complete an unverified original booking.");
        assert.deepEqual(await page.evaluate(() => Object.entries(localStorage)
          .filter(([key]) => key.startsWith("glowflow.booking.pending.route-fixture."))),
        [[`glowflow.booking.pending.route-fixture.${savedIntentId}`, "1"]],
        "The prepared intent stays identifiable for a later exact recovery check.");
      }
    } else {
      await page.getByRole("button", { name: "Check original request" }).click();
    }
    if (!nonCommitted) await page.getByRole("heading", { name: "Appointment confirmed", exact: true }).waitFor();
    assert.equal(scalar("select count(*) from public.appointments where tenant_id='10000000-0000-0000-0000-000000000001'"), nonCommitted ? "0" : "1");
    if (!nonCommitted) {
      assert.equal(scalar("select id from public.appointments where tenant_id='10000000-0000-0000-0000-000000000001'"), committedId);
    } else {
      assert.equal(scalar(`select state from private.public_booking_intents where id='${savedIntentId}'`), "prepared",
        "The cutover cannot turn a non-committed attempt into an appointment.");
    }
    assert.deepEqual(exactReconciles, [savedIntentId], "Check must reconcile only the exact original intent.");
    assert.equal(actions.filter(action => action === "prepare").length, 1);
    assert.equal(actions.filter(action => action === "commit").length, 1);
    assert.equal(legacyPosts, 0, "Neither the v2 booking nor recovery-only reload may post to the legacy route.");
    assert.ok(actions.filter(action => action === "reconcile").length >= 2);
    assert.equal(scalar("select count(distinct action_bucket) from private.public_booking_quota_counters where action_bucket in ('bootstrap','prepare','reconcile','commit')"), nonCommitted ? "3" : "4",
      "Only actions that reach the real route may consume capability quota.");
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    try {
      await browser?.close();
    } finally {
      await stopServer(active);
      // Deliberately do not print server output; it could contain diagnostic data.
      void serverOutput;
    }
  }
});

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

test("browser recovers one real local v2 booking after its committed response is lost", {
  skip: !database || !slotInput, timeout: 300_000,
}, async () => {
  checkedDatabaseUrl();
  const slot = JSON.parse(slotInput);
  assert.match(slot.start, /^\d{4}-\d{2}-\d{2}T/);
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
  const server = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"),
    "dev", "--webpack", "--hostname", "localhost", "--port", String(port)],
  { cwd: fixture, env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)),
    stdio: ["ignore", "pipe", "pipe"] });
  let browser;
  let serverOutput = "";
  server.stdout.on("data", value => { serverOutput = (serverOutput + value).slice(-4096); });
  server.stderr.on("data", value => { serverOutput = (serverOutput + value).slice(-4096); });
  try {
    const deadline = Date.now() + 120_000;
    while (true) {
      if (server.exitCode !== null) throw new Error("Local Next fixture exited before readiness.");
      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
        if (response.ok) break;
      } catch { /* Next is still starting. */ }
      if (Date.now() > deadline) throw new Error("Local Next fixture did not become ready.");
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { "x-forwarded-for": "192.0.2.10" } });
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    const actions = [];
    const exactReconciles = [];
    const errors = [];
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
        return route.fulfill({ json: { slots: match ? [{ slot_start: slot.start,
          staff_id: "20000000-0000-0000-0000-000000000002" }] : [] } });
      }
      if (url.pathname === "/api/public-booking/v2") {
        const payload = route.request().postDataJSON();
        const action = payload.action;
        actions.push(action); // Never retain contact details or the signed cookie.
        if (action === "reconcile" && payload.intentId) exactReconciles.push(payload.intentId);
        if (action === "commit" && !lostCommit) {
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
    assert.match(committedId, /^[0-9a-f-]{36}$/);
    assert.equal(scalar("select count(*) from public.appointments where tenant_id='10000000-0000-0000-0000-000000000001'"), "1");
    await page.getByRole("button", { name: "Check original request" }).click();
    await page.getByRole("heading", { name: "Appointment confirmed", exact: true }).waitFor();
    assert.equal(scalar("select count(*) from public.appointments where tenant_id='10000000-0000-0000-0000-000000000001'"), "1");
    assert.equal(scalar("select id from public.appointments where tenant_id='10000000-0000-0000-0000-000000000001'"), committedId);
    const savedIntentId = scalar("select id from private.public_booking_intents where tenant_id='10000000-0000-0000-0000-000000000001'");
    assert.deepEqual(exactReconciles, [savedIntentId], "Check must reconcile only the exact original intent.");
    assert.equal(actions.filter(action => action === "prepare").length, 1);
    assert.equal(actions.filter(action => action === "commit").length, 1);
    assert.ok(actions.filter(action => action === "reconcile").length >= 2);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    if (server.exitCode === null) server.kill("SIGTERM");
    // Deliberately do not print server output; it could contain diagnostic data.
    void serverOutput;
  }
});

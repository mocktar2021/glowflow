import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Optional local overrides support an existing browser runtime; CI uses the pinned dependency.
const { chromium } = await import(process.env.GLOWFLOW_PLAYWRIGHT_PATH ? pathToFileURL(process.env.GLOWFLOW_PLAYWRIGHT_PATH).href : "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = path.join(root, "tests/browser/fixture");
const artifacts = path.join(root, "test-results/browser");
let server, browser, origin;
let output = "";
const reservationId = "22222222-2222-4222-8222-222222222222";
const slot = { slot_start: "2030-01-15T10:00:00Z", staff_id: "33333333-3333-4333-8333-333333333333" };
const labels = {
  fr: { title: "Test d’acompte du salon", pay: "Tester le paiement de l’acompte", pending: "Paiement en cours de vérification", paid: "Acompte de test confirmé", failed: "Le paiement de test a échoué", expired: "Le créneau de test a expiré", refresh: "Vérifier le paiement", unavailable: "Le test est indisponible" },
  en: { title: "Salon deposit test", pay: "Test deposit payment", pending: "Payment verification is pending", paid: "Test deposit confirmed", failed: "Test payment failed", expired: "The test hold expired", refresh: "Check payment", unavailable: "Testing is unavailable" },
  es: { title: "Prueba de depósito del salón", pay: "Probar el pago del depósito", pending: "El pago está pendiente de verificación", paid: "Stripe confirmó el depósito", failed: "El pago de prueba falló", expired: "La retención de prueba caducó", refresh: "Verificar pago", unavailable: "La prueba no está disponible" },
};
before(async () => {
  await mkdir(artifacts, { recursive: true });
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  // No inherited application secrets: this fixture has no server-side API routes.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SUPABASE|STRIPE|GLOWFLOW_APP|VERCEL/.test(key)));
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: fixture, env: { ...env, NEXT_TELEMETRY_DISABLED: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", value => output += value);
  server.stderr.on("data", value => output += value);
  const deadline = Date.now() + 120000;
  while (true) {
    if (server.exitCode !== null) throw new Error(output);
    try { const response = await fetch(origin, { signal: AbortSignal.timeout(10000) }); if (response.ok) break; } catch { /* startup */ }
    if (Date.now() > deadline) throw new Error(`Fixture failed to start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.GLOWFLOW_CHROMIUM_PATH || undefined });
  await writeFile(path.join(artifacts, "runtime.json"), JSON.stringify({ node: process.version, browser: browser.version(), playwrightOverride: Boolean(process.env.GLOWFLOW_PLAYWRIGHT_PATH), chromiumOverride: Boolean(process.env.GLOWFLOW_CHROMIUM_PATH) }, null, 2));
}, { timeout: 150000 });
after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) {
    if (process.platform === "win32") {
      await new Promise(resolve => spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }).once("close", resolve));
    } else {
      server.kill("SIGTERM");
    }
  }
  await writeFile(path.join(artifacts, "server.log"), output);
});
async function pageFor(t, locale = "fr", { status = "pending", unavailable = false, delay = false, publicBooking = null, v2Booking = null, v2Cookie = false, timeZoneId, postCheckoutUrl = null, statusCheckoutUrl = "https://checkout.stripe.com/c/pay/cs_test_fixture" } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale, timeZoneId });
  if (v2Cookie) await context.addCookies([{ name: "fixture-v2-session", value: "ready", url: origin, httpOnly: true }]);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(90000); // Allow first-route compilation on slower local machines.
  const errors = [];
  const writes = [];
  const externalRequests = [];
  let state = status;
  let unavailableState = unavailable;
  let release;
  const barrier = delay ? new Promise(resolve => release = resolve) : Promise.resolve();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server rendered HTML/i.test(message.text())) errors.push(message.text()); });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      externalRequests.push(route.request().url());
      return route.abort();
    }
    if (url.pathname === "/api/public-booking") {
      if (publicBooking) return publicBooking(route, writes);
      assert.equal(route.request().method(), "GET", "sandbox must never submit a real booking");
      return route.fulfill({ json: { slots: [slot] } });
    }
    if (url.pathname === "/api/public-booking/v2") {
      assert.ok(v2Booking, "v2 booking API must be provided by an isolated fixture");
      return v2Booking(route, writes);
    }
    if (url.pathname === "/api/preferences/locale") return route.fulfill({ json: { saved: true } });
    if (url.pathname === "/api/checkout") {
      if (route.request().method() === "POST") {
        writes.push(route.request().postDataJSON());
        return route.fulfill({ status: unavailableState ? 503 : 200, json: unavailableState ? { error: "sandbox_unavailable" } : { reservationId, status: "pending", url: postCheckoutUrl } });
      }
      await barrier;
      return route.fulfill({ status: unavailableState ? 503 : 200, json: unavailableState ? { error: "sandbox_unavailable" } : { reservationId, status: state, url: state === "pending" ? statusCheckoutUrl : null } });
    }
    return route.continue();
  });
  t.after(async () => {
    try {
      await page.screenshot({ path: path.join(artifacts, `${t.name.replace(/[^a-z0-9-]/gi, "-")}.png`), fullPage: true });
      assert.deepEqual(errors, [], "no runtime/hydration errors");
      assert.equal(await page.locator("[data-nextjs-dialog], .vite-error-overlay").count(), 0);
    } finally { await context.close(); }
  });
  return { page, context, writes, externalRequests, setStatus: value => state = value, setUnavailable: value => unavailableState = value, release };
}
test("visitor time-zone chooser detects browser zone only for new searches and allows override", async t => {
  const { page } = await pageFor(t, "en", { timeZoneId: "America/Los_Angeles" });
  // The optional system Chromium can ignore Playwright's timeZoneId override.
  // Model the browser API response directly so this check is deterministic.
  await page.addInitScript(() => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      return { ...original.call(this), timeZone: "America/Los_Angeles" };
    };
  });
  const chooser = page.getByRole("combobox", { name: "Filter time zone" });
  await page.goto(`${origin}/en/book/browser-fixture?zoneFixture=1`);
  await chooser.waitFor();
  await page.waitForFunction(() => document.querySelector('[name="timeZone"]')?.value === "America/Los_Angeles");
  await chooser.selectOption("Europe/Paris");
  assert.equal(await chooser.inputValue(), "Europe/Paris");

  await page.goto(`${origin}/en/book/browser-fixture?zoneFixture=1&date=2026-11-15`);
  assert.equal(await chooser.inputValue(), "UTC", "a legacy date-only URL stays in UTC");

  await page.goto(`${origin}/en/book/browser-fixture?zoneFixture=1&date=2026-11-15&zone=Europe%2FParis`);
  assert.equal(await chooser.inputValue(), "Europe/Paris", "an explicit visitor zone stays selected");
});
async function selectBookingTime(page, start = slot.slot_start) {
  const radio = page.locator(`[name="bookingTime"][value="${start}"]`);
  await radio.locator("..").click();
  assert.equal(await radio.isChecked(), true);
}
for (const locale of ["fr", "en", "es"]) {
  test(`${locale} sandbox booking submits exact fixture and displays authoritative pending`, async t => {
    const { page, writes } = await pageFor(t, locale);
    await page.goto(`${origin}/${locale}/book/browser-fixture?sandbox=1`);
    await page.getByRole("heading", { name: labels[locale].title }).waitFor();
    await selectBookingTime(page);
    await page.locator('[name="fullName"]').fill("Fictional Browser Client");
    await page.locator('[name="email"]').fill("browser@example.invalid");
    await page.getByRole("button", { name: labels[locale].pay, exact: true }).click();
    await page.waitForURL(`**sandboxReservation=${reservationId}`);
    await page.getByRole("status").filter({ hasText: labels[locale].pending }).waitFor();
    assert.equal(writes.length, 1);
    const { requestKey, ...payload } = writes[0];
    assert.deepEqual(payload, { salonSlug: "browser-fixture", serviceId: "11111111-1111-4111-8111-111111111111", staffId: slot.staff_id, startTime: slot.slot_start, fullName: "Fictional Browser Client", phone: "", email: "browser@example.invalid", locale });
    assert.match(requestKey, /^[0-9a-f-]{36}$/);
    assert.equal("amount" in writes[0], false);
  });
}
test("locale switch preserves sandbox query and hash", async t => {
  const { page } = await pageFor(t);
  await page.goto(`${origin}/fr/book/browser-fixture?sandbox=1#booking`);
  await page.getByRole("button", { name: "Changer de langue" }).click();
  await page.getByRole("menuitemradio").filter({ hasText: "EN" }).click();
  await page.waitForURL(`${origin}/en/book/browser-fixture?sandbox=1#booking`);
  await page.getByRole("heading", { name: labels.en.title }).waitFor();
});
for (const locale of ["fr", "en", "es"]) {
  for (const status of ["paid", "failed", "expired"]) {
    test(`${locale} pending transitions to ${status} only after authoritative refresh`, async t => {
      const { page, setStatus, release } = await pageFor(t, locale, { delay: true });
      await page.goto(`${origin}/${locale}/book/browser-fixture?sandboxReservation=${reservationId}&paid=true`);
      await page.getByRole("status").filter({ hasText: labels[locale].pending }).waitFor();
      assert.equal(await page.getByText(labels[locale].paid, { exact: false }).count(), 0);
      release();
      await page.getByRole("link", { name: labels[locale].pay }).waitFor();
      assert.equal(await page.getByRole("link", { name: labels[locale].pay }).getAttribute("href"), "https://checkout.stripe.com/c/pay/cs_test_fixture");
      setStatus(status);
      await page.getByRole("button", { name: labels[locale].refresh }).click();
      await page.getByRole("status").filter({ hasText: labels[locale][status] }).waitFor();
      assert.equal(await page.getByRole("link", { name: labels[locale].pay }).count(), 0);
    });
  }
}
test("unavailable status hides stale checkout continuation", async t => {
  const { page, setUnavailable } = await pageFor(t, "es");
  await page.goto(`${origin}/es/book/browser-fixture?sandboxReservation=${reservationId}`);
  await page.getByRole("link", { name: labels.es.pay }).waitFor();
  setUnavailable(true);
  await page.getByRole("button", { name: labels.es.refresh }).click();
  await page.getByRole("alert").filter({ hasText: labels.es.unavailable }).waitFor();
  assert.equal(await page.getByRole("link", { name: labels.es.pay }).count(), 0);
});
test("unavailable checkout stays in sandbox and never confirms a booking", async t => {
  const { page, writes } = await pageFor(t, "en", { unavailable: true });
  await page.goto(`${origin}/en/book/browser-fixture?sandbox=1`);
  await selectBookingTime(page);
  await page.locator('[name="fullName"]').fill("Fictional Browser Client");
  await page.locator('[name="phone"]').fill("0000000000");
  await page.getByRole("button", { name: labels.en.pay, exact: true }).click();
  await page.getByRole("alert").filter({ hasText: labels.en.unavailable }).waitFor();
  assert.equal(writes.length, 1);
  assert.equal(new URL(page.url()).searchParams.get("sandbox"), "1");
  assert.equal(await page.getByRole("heading", { name: "Appointment confirmed" }).count(), 0);
});

test("sandbox deposit retry reuses the request key after an unavailable response", async t => {
  const { page, writes, externalRequests, setUnavailable } = await pageFor(t, "en", { unavailable: true });
  await page.goto(`${origin}/en/book/browser-fixture?sandbox=1`);
  await selectBookingTime(page);
  await page.locator('[name="fullName"]').fill("Fictional Browser Client");
  await page.locator('[name="email"]').fill("browser@example.invalid");
  await page.getByRole("button", { name: labels.en.pay, exact: true }).click();
  await page.getByRole("alert").filter({ hasText: labels.en.unavailable }).waitFor();
  assert.equal(writes.length, 1);
  assert.equal(await page.getByRole("heading", { name: "Appointment confirmed" }).count(), 0);
  setUnavailable(false);
  await page.getByRole("button", { name: labels.en.pay, exact: true }).click();
  await page.waitForURL(`**sandboxReservation=${reservationId}`);
  assert.equal(writes.length, 2);
  assert.match(writes[0].requestKey, /^[0-9a-f-]{36}$/);
  assert.deepEqual(writes[1], writes[0]);
  assert.deepEqual(externalRequests, []);
});

test("changed contact details after unavailable deposit checkout get a new request key", async t => {
  const { page, writes, externalRequests, setUnavailable } = await pageFor(t, "en", { unavailable: true });
  await page.goto(`${origin}/en/book/browser-fixture?sandbox=1`);
  await selectBookingTime(page);
  await page.locator('[name="fullName"]').fill("Fictional Browser Client");
  await page.locator('[name="email"]').fill("original@example.invalid");
  await page.getByRole("button", { name: labels.en.pay, exact: true }).click();
  await page.getByRole("alert").filter({ hasText: labels.en.unavailable }).waitFor();
  assert.equal(writes.length, 1);
  assert.equal(await page.getByRole("heading", { name: "Appointment confirmed" }).count(), 0);

  setUnavailable(false);
  await page.locator('[name="email"]').fill("updated@example.invalid");
  await page.getByRole("button", { name: labels.en.pay, exact: true }).click();
  await page.waitForURL(`**sandboxReservation=${reservationId}`);
  assert.equal(writes.length, 2);
  const { requestKey: firstKey, ...firstPayload } = writes[0];
  const { requestKey: secondKey, ...secondPayload } = writes[1];
  assert.match(firstKey, /^[0-9a-f-]{36}$/);
  assert.match(secondKey, /^[0-9a-f-]{36}$/);
  assert.notEqual(secondKey, firstKey, "a changed booking payload cannot reuse a prior reservation key");
  assert.deepEqual(secondPayload, { ...firstPayload, email: "updated@example.invalid" });
  assert.deepEqual(externalRequests, []);
});

for (const checkoutUrl of [
  "https://checkout.stripe.com.evil.example/c/pay/cs_test_fixture",
  "http://checkout.stripe.com/c/pay/cs_test_fixture",
  "javascript:alert(1)",
  "/fr/dashboard/payments",
]) {
  test(`sandbox booking refuses untrusted checkout destination ${checkoutUrl}`, async t => {
    const { page, writes, externalRequests } = await pageFor(t, "en", { postCheckoutUrl: checkoutUrl });
    await page.goto(`${origin}/en/book/browser-fixture?sandbox=1`);
    await selectBookingTime(page);
    await page.locator('[name="fullName"]').fill("Fictional Browser Client");
    await page.locator('[name="email"]').fill("browser@example.invalid");
    await page.getByRole("button", { name: labels.en.pay, exact: true }).click();
    await page.getByRole("alert").filter({ hasText: labels.en.unavailable }).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(page.url(), `${origin}/en/book/browser-fixture?sandbox=1`);
    assert.deepEqual(externalRequests, [], "fixture must not request a checkout or other external host");
    assert.equal(await page.getByRole("heading", { name: "Appointment confirmed" }).count(), 0);
  });
}

test("pending deposit status exposes only a genuine Stripe Checkout link", async t => {
  const { page, writes, externalRequests } = await pageFor(t, "en", {
    statusCheckoutUrl: "https://checkout.stripe.com.evil.example/c/pay/cs_test_fixture",
  });
  const statusResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/checkout" && response.request().method() === "GET");
  await page.goto(`${origin}/en/book/browser-fixture?sandboxReservation=${reservationId}`);
  await statusResponse;
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent?.includes("Check payment") && !button.disabled));
  await page.getByRole("status").filter({ hasText: labels.en.pending }).waitFor();
  assert.equal(await page.getByRole("link", { name: labels.en.pay }).count(), 0);
  assert.deepEqual(writes, []);
  assert.deepEqual(externalRequests, []);
});

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} notification preview changes kind and applies language fallback without sending`, async t => {
    const { page } = await pageFor(t, locale);
    const mutations = [];
    page.on("request", request => { if (!["GET", "HEAD"].includes(request.method())) mutations.push(request.url()); });
    await page.goto(`${origin}/${locale}/book/browser-fixture?templates=1`);
    const status = page.getByRole("status");
    const initial = { fr: "Rendez-vous confirmé", en: "Appointment confirmed", es: "Cita confirmada" };
    await status.filter({ hasText: initial[locale] }).waitFor();
    await page.locator("#notification-kind").selectOption("reminder24h");
    const reminders = { fr: "Rappel : votre rendez-vous est dans 24 heures", en: "Reminder: your appointment is in 24 hours", es: "Recordatorio: su cita es en 24 horas" };
    await status.filter({ hasText: reminders[locale] }).waitFor();
    await page.locator("#notification-client").selectOption("");
    await page.locator("#notification-salon").selectOption("es");
    await status.filter({ hasText: reminders.es }).waitFor();
    assert.equal(await status.locator("p").getAttribute("lang"), "es");
    await page.locator("#notification-salon").selectOption("");
    await status.filter({ hasText: reminders.fr }).waitFor();
    await page.locator("#notification-client").selectOption("en");
    await page.locator("#notification-kind").selectOption("reminder2h");
    await status.filter({ hasText: "Reminder: your appointment is in 2 hours" }).waitFor();
    assert.deepEqual(mutations, [], "preview must not send messages or save settings");
  });
}

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} selected service stays attached to the sandbox booking payload`, async t => {
    const { page, writes } = await pageFor(t, locale);
    const selected = "44444444-4444-4444-8444-444444444444";
    await page.goto(`${origin}/${locale}/book/browser-fixture?sandbox=1&service=${selected}`);
    await page.getByRole("heading", { name: labels[locale].title }).waitFor();
    await page.getByText("Paris, FR", { exact: true }).waitFor();
    assert.equal(await page.locator('[name="bookingService"]').inputValue(), selected);
    await selectBookingTime(page);
    await page.locator('[name="fullName"]').fill("Fictional Browser Client");
    await page.locator('[name="email"]').fill("browser@example.invalid");
    await page.getByRole("button", { name: labels[locale].pay, exact: true }).click();
    await page.waitForURL(`**sandboxReservation=${reservationId}`);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].serviceId, selected);
    assert.equal(writes[0].locale, locale);
    assert.equal(writes[0].salonSlug, "browser-fixture");
  });
}

test("changing service then language preserves the current service and sandbox query", async t => {
  const { page, writes } = await pageFor(t, "fr");
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "44444444-4444-4444-8444-444444444444";
  await page.goto(`${origin}/fr/book/browser-fixture?sandbox=1&service=${second}#booking`);
  await page.getByRole("heading", { name: labels.fr.title }).waitFor();
  // The heading is server-rendered; the fixture slot appears after hydration and availability loading.
  await page.locator(`[name="bookingTime"][value="${slot.slot_start}"]`).waitFor({ state: "attached" });
  await page.locator('[name="bookingService"]').selectOption(first);
  assert.equal(new URL(page.url()).searchParams.get("service"), first);
  await page.getByRole("button", { name: "Changer de langue" }).click();
  await page.getByRole("menuitemradio").filter({ hasText: "EN" }).click();
  await page.waitForURL(`${origin}/en/book/browser-fixture?sandbox=1&service=${first}#booking`);
  await page.getByText("Paris, FR", { exact: true }).waitFor();
  assert.equal(await page.locator('[name="bookingService"]').inputValue(), first);
  await selectBookingTime(page);
  await page.locator('[name="fullName"]').fill("Fictional Browser Client");
  await page.locator('[name="email"]').fill("browser@example.invalid");
  await page.getByRole("button", { name: labels.en.pay, exact: true }).click();
  await page.waitForURL(`**sandboxReservation=${reservationId}`);
  assert.equal(writes[0].serviceId, first);
  assert.equal(writes[0].locale, "en");
  assert.equal("countryCode" in writes[0], false, "checkout derives country from the selected salon, not a browser field");
});

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} controlled booking choices wait for hydration before accepting input`, async t => {
    const { page } = await pageFor(t, locale);
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "44444444-4444-4444-8444-444444444444";
    const ben = "66666666-6666-4666-8666-666666666666";
    let releaseJs;
    const barrier = new Promise(resolve => { releaseJs = resolve; });
    let paused = 0;
    await page.route("**/_next/static/**/*.js*", async route => {
      paused++;
      await barrier;
      await route.continue();
    });
    try {
      await page.goto(`${origin}/${locale}/book/browser-fixture?sandbox=1&service=${second}#booking`, { waitUntil: "domcontentloaded" });
      assert.ok(paused > 0, "the fixture must hold hydration scripts");
      const service = page.locator('[name="bookingService"]');
      const staff = page.locator('[name="bookingStaff"]');
      const date = page.locator('[type="date"]');
      const name = page.locator('[name="fullName"]');
      assert.equal(await service.inputValue(), second);
      assert.equal(await service.isDisabled(), true, "a pre-hydration choice cannot be honored");
      assert.equal(await staff.isDisabled(), true);
      assert.equal(await date.isDisabled(), true);
      await assert.rejects(service.selectOption(first, { timeout: 300 }), /Timeout/);
      await assert.rejects(staff.selectOption(ben, { timeout: 300 }), /Timeout/);
      await assert.rejects(date.fill("2030-01-16", { timeout: 300 }), /Timeout/);
      assert.equal(await service.inputValue(), second);
      assert.equal(await staff.inputValue(), "");
      assert.equal(new URL(page.url()).searchParams.get("service"), second);
      await name.fill("Fictional Browser Client");

      releaseJs();
      await page.locator(`[name="bookingTime"][value="${slot.slot_start}"]`).waitFor({ state: "attached" });
      assert.equal(await service.isEnabled(), true);
      assert.equal(await staff.isEnabled(), true);
      assert.equal(await date.isEnabled(), true);
      assert.equal(await name.inputValue(), "Fictional Browser Client", "uncontrolled contact input remains editable");
      await service.selectOption(first);
      await staff.selectOption(ben);
      await date.fill("2030-01-16");
      assert.equal(await service.inputValue(), first);
      assert.equal(await staff.inputValue(), ben);
      assert.equal(await date.inputValue(), "2030-01-16");
      assert.equal(new URL(page.url()).searchParams.get("service"), first);
    } finally {
      releaseJs();
    }
  });
}

test("named professional filters available times and submits that professional", async t => {
  const ben = { slot_start: "2030-01-15T11:00:00Z", staff_id: "66666666-6666-4666-8666-666666666666" };
  const { page, writes } = await pageFor(t, "en", { publicBooking: async (route, writes) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot, ben] } });
    writes.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { confirmation: confirmedBooking("en", ben.slot_start) } });
  } });
  await page.goto(`${origin}/en/book/browser-fixture`);
  await page.locator(`[name="bookingTime"][value="${slot.slot_start}"]`).waitFor();
  assert.equal(await page.locator('[name="bookingTime"]').count(), 2);
  await selectBookingTime(page);
  await page.locator('[name="bookingStaff"]').selectOption(ben.staff_id);
  assert.equal(await page.locator('[name="bookingTime"]:checked').count(), 0);
  assert.equal(await page.locator(`[name="bookingTime"][value="${slot.slot_start}"]`).count(), 0);
  await fillBooking(page, "en", ben.slot_start);
  await page.getByRole("heading", { name: "Appointment confirmed", exact: true }).waitFor();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].staffId, ben.staff_id);
  assert.equal(writes[0].startTime, ben.slot_start);
});

test("unavailable preferred professional never silently changes and can return to all", async t => {
  const { page, writes } = await pageFor(t, "en", { publicBooking: async (route, writes) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot] } });
    writes.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { confirmation: confirmedBooking("en") } });
  } });
  await page.goto(`${origin}/en/book/browser-fixture`);
  await page.locator(`[name="bookingTime"][value="${slot.slot_start}"]`).waitFor();
  await page.locator('[name="bookingStaff"]').selectOption("66666666-6666-4666-8666-666666666666");
  await page.getByText("This professional has no times on this date.").waitFor();
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.equal(writes.length, 0);
  await page.getByRole("button", { name: "Show all professionals" }).click();
  assert.equal(await page.locator('[name="bookingStaff"]').inputValue(), "");
  await page.locator(`[name="bookingTime"][value="${slot.slot_start}"]`).waitFor();
  await page.locator('[name="bookingStaff"]').selectOption(slot.staff_id);
  await page.locator('[name="bookingService"]').selectOption("44444444-4444-4444-8444-444444444444");
  assert.equal(await page.locator('[name="bookingStaff"]').inputValue(), "");
});

const confirmationLabels = {
  fr: { submit: "Confirmer le rendez-vous", success: "Rendez-vous confirmé", conflict: "Ce créneau vient d’être réservé. Choisissez un autre horaire.", contact: "Ajoutez un téléphone ou un e-mail." },
  en: { submit: "Confirm appointment", success: "Appointment confirmed", conflict: "Someone booked this time. Choose another time.", contact: "Add a phone number or email." },
  es: { submit: "Confirmar cita", success: "Cita confirmada", conflict: "Otra persona reservó esta hora. Elige otra.", contact: "Añade un teléfono o correo." },
};
const uncertainLabels = {
  fr: { warning: "Votre réservation a peut-être été enregistrée", check: "Vérifier la demande initiale", retry: "Réessayer la demande initiale" },
  en: { warning: "Your booking may have succeeded", check: "Check original request", retry: "Retry original request" },
  es: { warning: "Es posible que tu reserva se haya registrado", check: "Comprobar la solicitud original", retry: "Reintentar la solicitud original" },
};
const legacyCutoverLabels = {
  fr: { warning: "Cette page de réservation ne peut plus envoyer de demandes", help: "Contactez le salon pour vérifier cette demande" },
  en: { warning: "This booking page can no longer submit requests", help: "Contact the salon to verify this request" },
  es: { warning: "Esta página de reservas ya no puede enviar solicitudes", help: "Contacta con el salón para comprobar esta solicitud" },
};
function confirmedBooking(locale, start = slot.slot_start) {
  return {
    appointment_id: "55555555-5555-4555-8555-555555555555",
    confirmed_start: start, confirmed_end: "2030-01-15T11:30:00Z",
    salon_name: "Verified Salon", service_title: { fr: "Prestation réservée", en: "Booked service", es: "Servicio reservado" },
    currency: "USD", saved_locale: locale,
    details: {
      time_zone: "America/New_York", address: "123 Fictional Street, New York, US",
      policies: { fr: "Annulation : contactez le salon 24 heures avant.", en: "Cancellation: contact the salon 24 hours ahead.", es: "Cancelación: contacta al salón con 24 horas de antelación." },
      catalog_price: 7200, currency: "USD", service_title: { fr: "Prestation réservée", en: "Booked service", es: "Servicio reservado" },
    },
  };
}
async function fillBooking(page, locale, start = slot.slot_start) {
  await selectBookingTime(page, start);
  await page.locator('[name="fullName"]').fill("Fictional Browser Client");
  await page.locator('[name="email"]').fill("browser@example.invalid");
  await page.getByRole("button", { name: confirmationLabels[locale].submit, exact: true }).click();
}
for (const locale of ["fr", "en", "es"]) {
  test(`${locale} narrow-screen booking supports keyboard time choice and accessible contact recovery`, async t => {
    const { page, writes } = await pageFor(t, locale, { publicBooking: async (route, writes) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot] } });
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { confirmation: confirmedBooking(locale) } });
    } });
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`${origin}/${locale}/book/browser-fixture`);
    const radio = page.locator(`[name="bookingTime"][value="${slot.slot_start}"]`);
    await radio.waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "booking must not scroll horizontally");
    await radio.focus();
    await page.keyboard.press("Space");
    assert.equal(await radio.isChecked(), true);
    await page.locator('[name="fullName"]').fill("Fictional Browser Client");
    await page.getByRole("button", { name: confirmationLabels[locale].submit, exact: true }).click();
    await page.getByRole("alert").filter({ hasText: confirmationLabels[locale].contact }).waitFor();
    const phone = page.locator('[name="phone"]');
    assert.equal(await phone.evaluate(element => document.activeElement === element), true);
    assert.equal(await phone.getAttribute("aria-invalid"), "true");
    assert.match(await phone.getAttribute("aria-describedby"), /booking-contact-error/);
    await page.locator('[name="email"]').fill("browser@example.invalid");
    await page.locator("#booking-contact-error").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#booking-contact-error").count(), 0);
    assert.equal(await phone.getAttribute("aria-invalid"), "false");
    await page.getByRole("button", { name: confirmationLabels[locale].submit, exact: true }).click();
    await page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "confirmation must not scroll horizontally");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].locale, locale);
  });
}
for (const locale of ["fr", "en", "es"]) {
  test(`${locale} public booking confirmation uses returned salon details and local time`, async t => {
    const confirmation = confirmedBooking(locale);
    const { page, writes } = await pageFor(t, locale, { publicBooking: async (route, writes) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot] } });
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { confirmation } });
    } });
    await page.goto(`${origin}/${locale}/book/browser-fixture`);
    await fillBooking(page, locale);
    const heading = page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true });
    await heading.waitFor();
    await page.waitForFunction(() => document.activeElement?.tagName === "H1");
    const body = await page.locator("main").innerText();
    assert.ok(body.includes(confirmation.details.address));
    assert.ok(body.includes(confirmation.details.policies[locale]));
    assert.ok(body.includes("America/New_York"));
    assert.ok(body.includes("USD"));
    assert.match(body, /72[,.]00/);
    const paymentCopy = { fr: "Aucun paiement en ligne", en: "No online payment", es: "No se ha cobrado ningún pago en línea" };
    assert.ok(body.includes(paymentCopy[locale]));
    assert.ok(body.includes("Verified Salon"));
    const localTime = new Intl.DateTimeFormat(locale, { timeZone: "America/New_York", timeStyle: "short" }).format(new Date(slot.slot_start));
    assert.ok(body.includes(localTime), `must show the returned salon time ${localTime}`);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].locale, locale);
    assert.equal("catalog_price" in writes[0], false);
    assert.equal("policies" in writes[0], false);
  });
}
for (const locale of ["fr", "en", "es"]) {
  test(`${locale} public booking recovers from a taken slot before confirming a replacement`, async t => {
    const replacement = { ...slot, slot_start: "2030-01-15T11:00:00Z" };
    let conflicted = false;
    const { page, writes } = await pageFor(t, locale, { publicBooking: async (route, writes) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { slots: [conflicted ? replacement : slot] } });
      writes.push(route.request().postDataJSON());
      if (!conflicted) { conflicted = true; return route.fulfill({ status: 409, json: { error: "slot_unavailable" } }); }
      return route.fulfill({ status: 201, json: { confirmation: confirmedBooking(locale, replacement.slot_start) } });
    } });
    await page.goto(`${origin}/${locale}/book/browser-fixture`);
    await fillBooking(page, locale);
    await page.getByRole("alert").filter({ hasText: confirmationLabels[locale].conflict }).waitFor();
    await page.locator(`input[type="radio"][value="${replacement.slot_start}"]`).waitFor();
    assert.equal(await page.locator('input[type="radio"]:checked').count(), 0);
    assert.equal(await page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).count(), 0);
    await fillBooking(page, locale, replacement.slot_start);
    await page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).waitFor();
    assert.equal(writes.length, 2);
    assert.equal(writes[0].locale, locale);
    assert.equal(writes[1].locale, locale);
    assert.equal(writes[1].startTime, replacement.slot_start);
    assert.notEqual(writes[1].requestKey, writes[0].requestKey);
  });
}

test("pending public booking accepts only one submission even if the form fires again", async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { page, writes, externalRequests } = await pageFor(t, "en", { publicBooking: async (route, requests) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot] } });
    requests.push(route.request().postDataJSON());
    await pending;
    return route.fulfill({ status: 201, json: { confirmation: confirmedBooking("en") } });
  } });
  try {
    await page.goto(`${origin}/en/book/browser-fixture`);
    await fillBooking(page, "en");
    await page.waitForFunction(() => document.querySelector("form")?.getAttribute("aria-busy") === "true");
    const submit = page.getByRole("button", { name: "Confirming…" });
    assert.equal(await submit.isDisabled(), true);
    await page.locator("form").dispatchEvent("submit");
    assert.equal(writes.length, 1, "a duplicate submit event must not start another POST");
  } finally {
    release?.();
  }
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  assert.equal(writes.length, 1);
  assert.deepEqual(externalRequests, []);
});

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} committed booking with lost response freezes changes and reconciles the original key`, async t => {
    const replacement = { ...slot, slot_start: "2030-01-15T11:00:00Z" };
    const appointments = new Map();
    const { page, writes, externalRequests } = await pageFor(t, locale, { publicBooking: async (route, requests) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot, replacement] } });
      const payload = route.request().postDataJSON();
      requests.push(payload);
      if (!appointments.has(payload.requestKey)) appointments.set(payload.requestKey, confirmedBooking(locale));
      if (requests.length === 1) return route.abort("failed"); // Server committed; only its response was lost.
      return route.fulfill({ status: 201, json: { confirmation: appointments.get(payload.requestKey) } });
    } });
    await page.goto(`${origin}/${locale}/book/browser-fixture`);
    await fillBooking(page, locale);
    await page.getByRole("alert").filter({ hasText: uncertainLabels[locale].warning }).waitFor();
    await page.waitForFunction(() => document.activeElement?.tagName === "H2");
    await page.keyboard.press("Tab");
    const recoveryButton = page.getByRole("button", { name: uncertainLabels[locale].retry });
    assert.equal(await recoveryButton.evaluate(element => document.activeElement === element), true);
    assert.notEqual(await recoveryButton.evaluate(element => getComputedStyle(element).outlineStyle), "none", "keyboard recovery focus must be visible");
    assert.equal(appointments.size, 1, "first request committed before the response was lost");
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0, "the changed time cannot be selected while unresolved");
    assert.equal(await page.locator('[name="email"]').count(), 0, "changed contact cannot be submitted while unresolved");
    await page.locator("form").dispatchEvent("submit");
    assert.equal(writes.length, 1, "a synthetic form submit cannot bypass the recovery guard");
    await page.getByRole("button", { name: uncertainLabels[locale].retry }).click();
    await page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).waitFor();
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], writes[0], "reconciliation must retry the original payload and request key");
    assert.equal(appointments.size, 1, "no second appointment is created");
    assert.deepEqual(externalRequests, []);
  });
}

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} legacy 410 directly locks the original request for manual salon verification`, async t => {
    const { page, writes, externalRequests } = await pageFor(t, locale, { publicBooking: async (route, requests) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot] } });
      requests.push(route.request().postDataJSON());
      return route.fulfill({ status: 410, json: { error: "booking_contract_changed" } });
    } });
    await page.goto(`${origin}/${locale}/book/browser-fixture`);
    await fillBooking(page, locale);
    const warning = page.getByRole("alert").filter({ hasText: legacyCutoverLabels[locale].warning });
    await warning.waitFor();
    await page.waitForFunction(() => document.activeElement?.tagName === "H2");
    assert.match(await warning.innerText(), new RegExp(legacyCutoverLabels[locale].help));
    assert.equal(await page.getByRole("button", { name: uncertainLabels[locale].retry }).count(), 0);
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    assert.equal(await page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).count(), 0);
    assert.equal(writes.length, 1);
    assert.match(writes[0].requestKey, /^[0-9a-f-]{36}$/);
    await page.locator("form").dispatchEvent("submit");
    assert.equal(writes.length, 1, "the locked old page cannot create a second request key");
    assert.deepEqual(externalRequests, []);
  });

  test(`${locale} legacy 410 after a lost response preserves the original key but stops retries`, async t => {
    const { page, writes, externalRequests } = await pageFor(t, locale, { publicBooking: async (route, requests) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot] } });
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) return route.abort("failed");
      return route.fulfill({ status: 410, json: { error: "booking_contract_changed" } });
    } });
    await page.goto(`${origin}/${locale}/book/browser-fixture`);
    await fillBooking(page, locale);
    await page.getByRole("alert").filter({ hasText: uncertainLabels[locale].warning }).waitFor();
    await page.getByRole("button", { name: uncertainLabels[locale].retry }).click();
    const warning = page.getByRole("alert").filter({ hasText: legacyCutoverLabels[locale].warning });
    await warning.waitFor();
    await page.waitForFunction(expected => document.activeElement?.tagName === "H2"
      && document.activeElement.textContent?.includes(expected), legacyCutoverLabels[locale].warning);
    assert.match(await warning.innerText(), new RegExp(legacyCutoverLabels[locale].help));
    assert.deepEqual(writes[1], writes[0], "the handoff response followed an unchanged original key and payload");
    assert.equal(await page.getByRole("button", { name: uncertainLabels[locale].retry }).count(), 0);
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    assert.equal(await page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).count(), 0,
      "a 410 cannot prove whether the earlier request committed");
    await page.locator("form").dispatchEvent("submit");
    assert.equal(writes.length, 2, "manual handoff cannot send a third POST or changed request key");
    assert.deepEqual(externalRequests, []);
  });
}

test("only the exact legacy booking-contract 410 enters manual-only cutover recovery", async t => {
  const { page, writes } = await pageFor(t, "en", { publicBooking: async (route, requests) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot] } });
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 410, json: { error: "other_contract" } });
  } });
  await page.goto(`${origin}/en/book/browser-fixture`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  assert.equal(await page.getByText(legacyCutoverLabels.en.warning).count(), 0);
  assert.equal(await page.getByRole("button", { name: uncertainLabels.en.retry }).count(), 1);
  assert.equal(writes.length, 1);
});

test("a malformed acknowledgement after a committed lost response keeps the original key locked", async t => {
  const appointments = new Map();
  const { page, writes, externalRequests } = await pageFor(t, "en", { publicBooking: async (route, requests) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot] } });
    const payload = route.request().postDataJSON();
    requests.push(payload);
    if (!appointments.has(payload.requestKey)) appointments.set(payload.requestKey, confirmedBooking("en"));
    if (requests.length === 1) return route.abort("failed");
    if (requests.length === 2) return route.fulfill({ status: 201, json: { confirmation: {} } });
    return route.fulfill({ status: 201, json: { confirmation: appointments.get(payload.requestKey) } });
  } });
  await page.goto(`${origin}/en/book/browser-fixture`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  await page.getByRole("button", { name: uncertainLabels.en.retry }).click();
  await page.getByRole("button", { name: uncertainLabels.en.retry }).waitFor();
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  await page.locator("form").dispatchEvent("submit");
  assert.equal(writes.length, 2, "malformed success cannot unlock a changed submission");
  await page.getByRole("button", { name: uncertainLabels.en.retry }).click();
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  assert.equal(writes.length, 3);
  assert.deepEqual(writes[1], writes[0]);
  assert.deepEqual(writes[2], writes[0]);
  assert.equal(appointments.size, 1);
  assert.deepEqual(externalRequests, []);
});

test("a wrong-time confirmation cannot reconcile a committed booking, but an equivalent instant can", async t => {
  const appointments = new Map();
  const { page, writes, externalRequests } = await pageFor(t, "en", { publicBooking: async (route, requests) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot] } });
    const payload = route.request().postDataJSON();
    requests.push(payload);
    if (!appointments.has(payload.requestKey)) appointments.set(payload.requestKey, confirmedBooking("en"));
    if (requests.length === 1) return route.abort("failed");
    if (requests.length === 2) return route.fulfill({ status: 201, json: { confirmation: confirmedBooking("en", "2030-01-15T11:00:00+00:00") } });
    return route.fulfill({ status: 201, json: { confirmation: confirmedBooking("en", "2030-01-15T10:00:00+00:00") } });
  } });
  await page.goto(`${origin}/en/book/browser-fixture`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  await page.getByRole("button", { name: uncertainLabels.en.retry }).click();
  await page.getByRole("button", { name: uncertainLabels.en.retry }).waitFor();
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0, "wrong-time acknowledgement must keep the page locked");
  await page.locator("form").dispatchEvent("submit");
  assert.equal(writes.length, 2);
  await page.getByRole("button", { name: uncertainLabels.en.retry }).click();
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  assert.equal(writes.length, 3);
  assert.deepEqual(writes[1], writes[0]);
  assert.deepEqual(writes[2], writes[0]);
  assert.equal(appointments.size, 1);
  assert.deepEqual(externalRequests, []);
});

for (const { status, error } of [{ status: 409, error: "slot_unavailable" }, { status: 400, error: "invalid_request" }]) {
test(`a retry ${status} cannot unlock while the original request can still commit late`, async t => {
  const replacement = { ...slot, slot_start: "2030-01-15T11:00:00Z" };
  const appointments = new Map();
  let originalPayload;
  let secondSeen;
  const secondRequest = new Promise(resolve => { secondSeen = resolve; });
  const { page, writes, externalRequests } = await pageFor(t, "en", { publicBooking: async (route, requests) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot, replacement] } });
    const payload = route.request().postDataJSON();
    requests.push(payload);
    if (requests.length === 1) {
      originalPayload = payload;
      return route.abort("failed"); // Browser loses the response while the server request is still queued.
    }
    if (requests.length === 2) {
      secondSeen();
      return route.fulfill({ status, json: { error } });
    }
    return route.fulfill({ status: 201, json: { confirmation: appointments.get(payload.requestKey) } });
  } });
  await page.goto(`${origin}/en/book/browser-fixture`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  await page.getByRole("button", { name: uncertainLabels.en.retry }).click();
  await secondRequest;
  await page.waitForFunction(() => document.querySelector("form")?.getAttribute("aria-busy") === "false");
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0, `a retry ${status} cannot expose another time`);
  await page.locator("form").dispatchEvent("submit");
  assert.equal(writes.length, 2, "a changed-key submission cannot race the delayed original");
  appointments.set(originalPayload.requestKey, confirmedBooking("en")); // Original server request commits after the retry 409.
  await page.getByRole("button", { name: uncertainLabels.en.retry }).click();
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  assert.deepEqual(writes[1], writes[0], "the uncertain request is retried unchanged");
  assert.deepEqual(writes[2], writes[0], "late commit is reconciled by the same original key");
  assert.equal(appointments.size, 1);
  assert.deepEqual(externalRequests, []);
});
}

const v2IntentId = "77777777-7777-4777-8777-777777777777";
const v2Generation = "88888888-8888-4888-8888-888888888888";
const v2NextGeneration = "99999999-9999-4999-8999-999999999999";
const v2MissingLabels = {
  fr: { service: "Prestation réservée", address: "Adresse non publiée.", price: "Tarif indisponible.", policies: "Conditions d’annulation non publiées." },
  en: { service: "Booked service", address: "Address not published.", price: "Price unavailable.", policies: "Cancellation policies are not published." },
  es: { service: "Servicio reservado", address: "Dirección no publicada.", price: "Precio no disponible.", policies: "Las condiciones de cancelación no están publicadas." },
};
const v2InactiveLabels = {
  fr: "Ce rendez-vous n’est plus actif. Contactez le salon avant de réserver à nouveau.",
  en: "This appointment is no longer active. Contact the salon before booking again.",
  es: "Esta cita ya no está activa. Contacta con el salón antes de reservar de nuevo.",
};
const v2LostSessionLabels = {
  fr: "La session de réservation de ce navigateur a été perdue.",
  en: "This browser’s booking session was lost.",
  es: "Se perdió la sesión de reserva de este navegador.",
};
const v2RateLimitLabels = {
  fr: { warning: "Trop de demandes de réservation", retry: "Réessayer" },
  en: { warning: "Too many booking requests", retry: "Try again" },
  es: { warning: "Hay demasiadas solicitudes de reserva", retry: "Reintentar" },
};
const v2FinishLabels = {
  fr: { finish: "Terminer la réservation initiale", service: "Coupe test" },
  en: { finish: "Finish the original booking", service: "Test haircut" },
  es: { finish: "Completar la reserva original", service: "Corte de prueba" },
};
function v2Confirmation(locale) {
  return { ...confirmedBooking(locale), salon_name: "", details: null, appointment_status: "confirmed" };
}
function v2PublishedConfirmation(locale) {
  return { ...v2Confirmation(locale), salon_name: "Published Salon", details: {
    time_zone: "Europe/Paris", address: "12 Public Street, Paris, 75001, FR",
    policies: { en: "Published policy" }, catalog_price: 5200, currency: "EUR",
    service_title: { fr: "Prestation réservée", en: "Booked service", es: "Servicio reservado" },
  } };
}
function v2Server(locale, { loseCommit = false, commitBeforeLoss = true, commitRateLimitAfterSave = false,
  loseSecondCommitAfterSave = false,
  loseCancel = false, appointmentStatus = "confirmed", published = false } = {}) {
  const appointments = new Map();
  let state = "none";
  let generation = v2Generation;
  let originalPayload = null;
  let lostOnce = false;
  let secondCommitLost = false;
  let cancelLostOnce = false;
  let resolveCommitHandled;
  // The uncertainty alert is rendered when submission begins, before prepare
  // or commit. Tests that reload after a lost response must wait for the
  // simulated server commit, not merely for that already-visible alert.
  const commitHandled = new Promise(resolve => { resolveCommitHandled = resolve; });
  const confirmation = { ...(published ? v2PublishedConfirmation(locale) : v2Confirmation(locale)), appointment_status: appointmentStatus };
  const handler = async (route, writes) => {
    const payload = route.request().postDataJSON();
    writes.push(payload);
    const cookie = route.request().headers().cookie?.includes("fixture-v2-session=ready");
    if (payload.action === "bootstrap") {
      return route.fulfill({ json: { ready: true, new_session: !cookie },
        ...(!cookie ? { headers: { "set-cookie": "fixture-v2-session=ready; HttpOnly; Path=/; SameSite=Lax" } } : {}) });
    }
    if (!cookie) return route.fulfill({ status: 409, json: { state: "unknown" } });
    if (payload.action === "reconcile") {
      if (payload.intentId && payload.intentId !== v2IntentId) return route.fulfill({ json: { state: "unknown" } });
      if (state === "none") return route.fulfill({ json: { state: "none", generation } });
      if (state === "prepared") return route.fulfill({ json: { state, generation, intent_id: v2IntentId } });
      if (state === "not_committed") return route.fulfill({ json: payload.intentId
        ? { state, generation, intent_id: v2IntentId } : { state: "none", generation } });
      return route.fulfill({ json: { state: "confirmed", generation, intent_id: v2IntentId, confirmation } });
    }
    if (payload.action === "prepare") {
      // The private prepare RPC returns unknown for a stale generation, not
      // an HTTP 409 (which means the signed browser cookie was rejected).
      if (payload.expectedGeneration !== generation) return route.fulfill({ json: { state: "unknown" } });
      if (state === "none") { state = "prepared"; originalPayload = payload; }
      if (state === "prepared") return route.fulfill({ json: { state, generation, intent_id: v2IntentId } });
      return route.fulfill({ json: { state: "confirmed", generation, intent_id: v2IntentId, confirmation } });
    }
    if (payload.action === "commit") {
      if (payload.intentId !== v2IntentId) return route.fulfill({ json: { state: "unknown" } });
      if (state === "prepared") {
        if (commitRateLimitAfterSave && !lostOnce) {
          lostOnce = true;
          state = "confirmed";
          appointments.set(v2IntentId, confirmation);
          resolveCommitHandled();
          return route.fulfill({ status: 429, headers: { "retry-after": "1" }, json: { state: "unknown" } });
        }
        if (loseCommit && !lostOnce) {
          lostOnce = true;
          if (commitBeforeLoss) { state = "confirmed"; appointments.set(v2IntentId, confirmation); }
          resolveCommitHandled();
          return route.abort("failed");
        }
        if (loseSecondCommitAfterSave && lostOnce && !secondCommitLost) {
          secondCommitLost = true;
          state = "confirmed";
          appointments.set(v2IntentId, confirmation);
          return route.abort("failed");
        }
        state = "confirmed";
        appointments.set(v2IntentId, confirmation);
      }
      resolveCommitHandled();
      return route.fulfill({ json: { state: "confirmed", generation, intent_id: v2IntentId, confirmation } });
    }
    if (payload.action === "cancel") {
      if (state === "prepared") { state = "not_committed"; generation = v2NextGeneration; }
      if (loseCancel && !cancelLostOnce) {
        cancelLostOnce = true;
        return route.abort("failed");
      }
      return route.fulfill({ json: state === "not_committed"
        ? { state, generation, intent_id: v2IntentId }
        : { state: "confirmed", generation, intent_id: v2IntentId, confirmation } });
    }
    if (payload.action === "acknowledge") {
      generation = v2NextGeneration;
      state = "none";
      return route.fulfill({ json: { state: "none", generation } });
    }
    throw Error(`unexpected fixture action ${payload.action}`);
  };
  return { handler, appointments, waitForCommitHandled: () => commitHandled,
    getOriginalPayload: () => originalPayload, getState: () => state };
}

const recoveryOnlyCopy = {
  fr: "Les nouvelles réservations sont suspendues sur cette page.",
  en: "New bookings are paused on this page.",
  es: "Las nuevas reservas están suspendidas en esta página.",
};
const anotherBookingCopy = {
  fr: "Prendre un autre rendez-vous",
  en: "Book another appointment",
  es: "Reservar otra cita",
};
const lostBookingSessionCopy = {
  fr: "La session de réservation de ce navigateur a été perdue.",
  en: "This browser’s booking session was lost.",
  es: "Se perdió la sesión de reserva de este navegador.",
};
for (const locale of ["fr", "en", "es"]) {
  test(`${locale} recovery-only page never starts a fresh browser session or booking`, async t => {
    const { page, writes, externalRequests } = await pageFor(t, locale, {
      v2Booking: async () => { throw new Error("recovery-only page must not call booking API without a marker"); },
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    await page.goto(`${origin}/${locale}/book/browser-fixture?v2=1&recoveryOnly=1`);
    const paused = page.getByRole("alert").filter({ hasText: recoveryOnlyCopy[locale] });
    await paused.waitFor();
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    assert.equal(await page.getByRole("button", { name: v2FinishLabels[locale].finish }).count(), 0);
    await page.locator("form").dispatchEvent("submit");
    assert.deepEqual(writes, []);
    assert.deepEqual(externalRequests, []);
  });

  test(`${locale} recovery-only page checks only the exact pending intent`, async t => {
    const { page, writes, externalRequests } = await pageFor(t, locale, {
      v2Cookie: true,
      v2Booking: async (route, requests) => {
        const payload = route.request().postDataJSON();
        requests.push(payload);
        if (payload.action === "bootstrap") return route.fulfill({ json: { ready: true, new_session: false, admission: "recovery_only" } });
        if (payload.action === "reconcile" && payload.intentId === v2IntentId)
          return route.fulfill({ json: { state: "prepared", generation: v2Generation, intent_id: v2IntentId } });
        throw new Error(`recovery-only attempted ${payload.action} without its exact pending intent`);
      },
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    await page.addInitScript(id => localStorage.setItem(`glowflow.booking.pending.browser-fixture.${id}`, "1"), v2IntentId);
    await page.goto(`${origin}/${locale}/book/browser-fixture?v2=1&recoveryOnly=1`);
    await page.locator('section[role="alert"]').waitFor();
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    assert.equal(await page.getByRole("button", { name: v2FinishLabels[locale].finish }).count(), 0,
      "a reloaded prepared intent has no immutable summary and cannot be finished blindly");
    await page.locator("form").dispatchEvent("submit");
    assert.deepEqual(writes.map(value => value.action), ["bootstrap", "reconcile"]);
    assert.equal(writes[1].intentId, v2IntentId);
    assert.deepEqual(externalRequests, []);
  });

  test(`${locale} recovery-only marker with no signed cookie stays manual-only`, async t => {
    const { page, writes, externalRequests } = await pageFor(t, locale, {
      v2Booking: async (route, requests) => {
        const payload = route.request().postDataJSON();
        requests.push(payload);
        assert.equal(payload.action, "bootstrap", "invalid capability cannot reach exact-intent RPC");
        return route.fulfill({ status: 409, json: { state: "unknown" } });
      },
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    await page.addInitScript(id => localStorage.setItem(`glowflow.booking.pending.browser-fixture.${id}`, "1"), v2IntentId);
    await page.goto(`${origin}/${locale}/book/browser-fixture?v2=1&recoveryOnly=1`);
    await page.getByRole("alert").filter({ hasText: lostBookingSessionCopy[locale] }).waitFor();
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    assert.equal(await page.getByRole("button", { name: uncertainLabels[locale].check }).count(), 0);
    assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))),
      [[`glowflow.booking.pending.browser-fixture.${v2IntentId}`, "1"]]);
    assert.deepEqual(writes.map(value => value.action), ["bootstrap"]);
    assert.deepEqual(externalRequests, []);
  });

  test(`${locale} stale full-v2 tab recognizes prepare pause without retrying or changing booking`, async t => {
    const server = v2Server(locale);
    const { page, writes, externalRequests } = await pageFor(t, locale, {
      v2Cookie: true,
      v2Booking: async (route, requests) => {
        const payload = route.request().postDataJSON();
        if (payload.action === "prepare") {
          requests.push(payload);
          return route.fulfill({ status: 503, json: { state: "unknown", error: "booking_paused" } });
        }
        return server.handler(route, requests);
      },
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    await page.goto(`${origin}/${locale}/book/browser-fixture?v2=1`);
    await fillBooking(page, locale);
    await page.getByRole("alert").filter({ hasText: recoveryOnlyCopy[locale] }).waitFor();
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    assert.equal(await page.getByRole("button", { name: uncertainLabels[locale].check }).count(), 0);
    await page.locator("form").dispatchEvent("submit");
    assert.deepEqual(writes.map(value => value.action), ["bootstrap", "reconcile", "prepare"]);
    assert.equal(server.appointments.size, 0);
    assert.deepEqual(externalRequests, []);
  });
}

test("stale full-v2 tab keeps an existing confirmation when recovery-only blocks another booking", async t => {
  const server = v2Server("en");
  let recoveryOnly = false;
  const { page, writes } = await pageFor(t, "en", {
    v2Cookie: true,
    v2Booking: async (route, requests) => {
      const payload = route.request().postDataJSON();
      if (recoveryOnly && payload.action === "reconcile" && !payload.intentId) {
        requests.push(payload);
        return route.fulfill({ status: 503, json: { state: "unknown", error: "booking_paused" } });
      }
      return server.handler(route, requests);
    },
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  assert.equal(server.appointments.size, 1);
  recoveryOnly = true;
  await page.getByRole("button", { name: "Book another appointment" }).click();
  await page.getByRole("status").filter({ hasText: recoveryOnlyCopy.en }).waitFor();
  assert.equal(await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Book another appointment" }).count(), 0);
  assert.equal(server.appointments.size, 1);
  assert.deepEqual(writes.map(value => value.action), ["bootstrap", "reconcile", "prepare", "commit", "acknowledge", "reconcile"]);
});

test("ordinary prepare 503 remains uncertain and offers read-only Check", async t => {
  const server = v2Server("en");
  const { page, writes } = await pageFor(t, "en", {
    v2Cookie: true,
    v2Booking: async (route, requests) => {
      const payload = route.request().postDataJSON();
      if (payload.action === "prepare") {
        requests.push(payload);
        return route.fulfill({ status: 503, json: { state: "unknown", error: "booking_unavailable" } });
      }
      return server.handler(route, requests);
    },
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: "Booking recovery is temporarily unavailable" }).waitFor();
  assert.equal(await page.getByRole("button", { name: uncertainLabels.en.check }).count(), 1);
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.deepEqual(writes.map(value => value.action), ["bootstrap", "reconcile", "prepare"]);
  assert.equal(server.appointments.size, 0);
});

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} recovery-only reload confirms the exact lost booking without a fresh session lookup`, async t => {
    const server = v2Server(locale, { loseCommit: true });
    const { page, writes } = await pageFor(t, locale, {
      v2Cookie: true, v2Booking: server.handler,
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    await page.goto(`${origin}/${locale}/book/browser-fixture?v2=1`);
    await fillBooking(page, locale);
    await waitForLostCommitToSettle(page, server);
    assert.equal(server.appointments.size, 1);
    const priorCount = writes.length;
    await page.goto(`${origin}/${locale}/book/browser-fixture?v2=1&recoveryOnly=1`);
    await page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).waitFor();
    assert.deepEqual(writes.slice(priorCount).map(value => [value.action, value.intentId ?? null]),
      [["bootstrap", null], ["reconcile", v2IntentId]]);
    assert.equal(await page.getByRole("button", { name: anotherBookingCopy[locale] }).count(), 0);
    assert.equal(server.appointments.size, 1);
  });

  test(`${locale} recovery-only reload resolves exact not-committed intent without a no-ID lookup`, async t => {
    const { page, writes } = await pageFor(t, locale, {
      v2Cookie: true,
      v2Booking: async (route, requests) => {
        const payload = route.request().postDataJSON();
        requests.push(payload);
        if (payload.action === "bootstrap") return route.fulfill({ json: { ready: true, new_session: false, admission: "recovery_only" } });
        if (payload.action === "reconcile" && payload.intentId === v2IntentId)
          return route.fulfill({ json: { state: "not_committed", generation: v2NextGeneration, intent_id: v2IntentId } });
        throw new Error(`unexpected recovery-only action ${payload.action}`);
      },
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    await page.addInitScript(id => localStorage.setItem(`glowflow.booking.pending.browser-fixture.${id}`, "1"), v2IntentId);
    await page.goto(`${origin}/${locale}/book/browser-fixture?v2=1&recoveryOnly=1`);
    await page.getByRole("alert").filter({ hasText: recoveryOnlyCopy[locale] }).waitFor();
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    assert.deepEqual(writes.map(value => [value.action, value.intentId ?? null]),
      [["bootstrap", null], ["reconcile", v2IntentId]]);
    assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))), []);
  });
}

async function waitForLostCommitToSettle(page, server) {
  let timeout;
  try {
    await Promise.race([
      server.waitForCommitHandled(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("fixture commit did not complete")), 30000); }),
    ]);
  } finally { clearTimeout(timeout); }
  await page.waitForFunction(() => document.querySelector("form")?.getAttribute("aria-busy") === "false");
}

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} v2 committed lost response recovers across reload and a new tab without a new prepare`, async t => {
    const server = v2Server(locale, { loseCommit: true });
    const { page, context, writes, externalRequests } = await pageFor(t, locale, { v2Booking: server.handler, v2Cookie: true,
      publicBooking: async route => route.fulfill({ json: { slots: [slot, { ...slot, slot_start: "2030-01-15T11:00:00Z" }] } }),
    });
    const url = `${origin}/${locale}/book/browser-fixture?v2=1`;
    await page.goto(url);
    await fillBooking(page, locale);
    await waitForLostCommitToSettle(page, server);
    await page.getByRole("alert").filter({ hasText: uncertainLabels[locale].warning }).waitFor();
    await page.waitForFunction(() => document.activeElement?.tagName === "H2");
    assert.equal(server.appointments.size, 1);
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    const markers = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending.")));
    assert.deepEqual(markers, [[`glowflow.booking.pending.browser-fixture.${v2IntentId}`, "1"]]);
    assert.doesNotMatch(JSON.stringify(markers), /Fictional Browser Client|browser@example.invalid|2030-01-15T/);
    await page.reload();
    await page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).waitFor();
    await page.getByText(v2MissingLabels[locale].service, { exact: true }).waitFor();
    await page.getByText(new RegExp(v2MissingLabels[locale].address)).waitFor();
    await page.getByText(new RegExp(v2MissingLabels[locale].price)).waitFor();
    await page.getByText(new RegExp(v2MissingLabels[locale].policies)).waitFor();
    assert.equal(await page.getByText("123 Fictional Street, New York, US").count(), 0,
      "v2 must not invent the v1 published-address enrichment");
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    const nextTab = await context.newPage();
    await nextTab.goto(url);
    await nextTab.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).waitFor();
    assert.equal(writes.filter(value => value.action === "prepare").length, 1);
    assert.equal(writes.filter(value => value.action === "commit").length, 1);
    assert.equal(server.appointments.size, 1);
    assert.deepEqual(externalRequests, []);
  });
}

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} v2 confirmation shows only appointment-bound published enrichment`, async t => {
    const server = v2Server(locale, { published: true });
    const { page, writes, externalRequests } = await pageFor(t, locale, { v2Booking: server.handler, v2Cookie: true,
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    await page.goto(`${origin}/${locale}/book/browser-fixture?v2=1`);
    await fillBooking(page, locale);
    await page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).waitFor();
    await page.getByText(v2MissingLabels[locale].service, { exact: true }).waitFor();
    await page.getByText("12 Public Street, Paris, 75001, FR", { exact: true }).waitFor();
    const policy = page.getByText("Published policy", { exact: true });
    await policy.waitFor();
    assert.equal(await policy.getAttribute("lang"), "en", "the missing locale falls back to the available policy language");
    const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(52);
    assert.ok((await page.locator("section dl").innerText()).includes(money));
    assert.ok((await page.locator("section dl").innerText()).includes("Published Salon"));
    const confirmationText = await page.locator("section").innerText();
    assert.ok(confirmationText.includes("Europe/Paris"));
    for (const missing of [v2MissingLabels[locale].address, v2MissingLabels[locale].price, v2MissingLabels[locale].policies]) {
      assert.equal(confirmationText.includes(missing), false, "published details must not show an unavailable-detail fallback");
    }
    assert.equal(writes.filter(value => value.action === "prepare").length, 1);
    assert.equal(writes.filter(value => value.action === "commit").length, 1);
    assert.deepEqual(externalRequests, []);
  });
}

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} v2 prepared recovery checks read-only until explicit original completion`, async t => {
    const server = v2Server(locale, { loseCommit: true, commitBeforeLoss: false });
    const { page, writes, externalRequests } = await pageFor(t, locale, { v2Booking: server.handler, v2Cookie: true,
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    await page.goto(`${origin}/${locale}/book/browser-fixture?v2=1`);
    await fillBooking(page, locale);
    await waitForLostCommitToSettle(page, server);
    assert.equal(server.appointments.size, 0);
    assert.equal(writes.filter(value => value.action === "commit").length, 1);
    assert.equal(await page.getByRole("button", { name: v2FinishLabels[locale].finish }).count(), 0);
    await page.getByRole("button", { name: uncertainLabels[locale].check }).click();
    const finish = page.getByRole("button", { name: v2FinishLabels[locale].finish });
    await finish.waitFor();
    const summaryTitle = { fr: "Rendez-vous initial à terminer", en: "Original booking to finish", es: "Reserva original por completar" }[locale];
    const summary = page.getByRole("heading", { name: summaryTitle }).locator("..");
    await page.waitForFunction(expected => document.activeElement?.tagName === "H3"
      && document.activeElement.textContent?.trim() === expected, summaryTitle);
    const summaryText = await summary.innerText();
    assert.match(summaryText, /Browser Fixture/);
    assert.match(summaryText, new RegExp(v2FinishLabels[locale].service));
    assert.match(summaryText, /Ari/);
    assert.match(summaryText, /Europe\/Paris/);
    assert.match(summaryText, /50/);
    assert.match(summaryText, /EUR/);
    assert.equal(writes.filter(value => value.action === "commit").length, 1,
      "checking the original request must not create an appointment");
    assert.equal(server.appointments.size, 0);
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    await finish.click();
    await page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).waitFor();
    assert.equal(writes.filter(value => value.action === "prepare").length, 1);
    assert.equal(writes.filter(value => value.action === "commit").length, 2,
      "the explicit action finishes the exact original intent only once");
    assert.equal(server.appointments.size, 1);
    assert.deepEqual(externalRequests, []);
  });
}

test("v2 prepared response loss stays locked after reload without an automatic commit", async t => {
  const server = v2Server("en", { loseCommit: true, commitBeforeLoss: false });
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: server.handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await waitForLostCommitToSettle(page, server);
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  assert.equal(server.getState(), "prepared");
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "This request is still pending" }).waitFor();
  assert.equal(await page.getByRole("button", { name: v2FinishLabels.en.finish }).count(), 0,
    "a reloaded tab has no verified original summary and cannot offer completion");
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  await page.getByRole("button", { name: uncertainLabels.en.check }).click();
  await page.getByRole("alert").filter({ hasText: "This request is still pending" }).waitFor();
  assert.equal(await page.getByRole("button", { name: v2FinishLabels.en.finish }).count(), 0);
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  assert.equal(writes.filter(value => value.action === "commit").length, 1);
  assert.equal(server.appointments.size, 0);
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.deepEqual(externalRequests, []);
});

test("v2 marker-only reload after cookie loss shows manual recovery and no changed submission", async t => {
  const server = v2Server("en", { loseCommit: true, commitBeforeLoss: false });
  const { page, context, writes, externalRequests } = await pageFor(t, "en", { v2Booking: server.handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await waitForLostCommitToSettle(page, server);
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  await context.clearCookies();
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "booking session was lost" }).waitFor();
  assert.equal(await page.getByText(/booking session was lost/).count(), 1, "manual warning must not repeat itself");
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.equal(await page.getByRole("button", { name: uncertainLabels.en.check }).count(), 0);
  await page.locator("form").dispatchEvent("submit");
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  assert.equal(writes.filter(value => value.action === "commit").length, 1);
  assert.deepEqual(externalRequests, []);
});

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} v2 rejected bootstrap cookie cannot offer a futile retry`, async t => {
    const { page, writes, externalRequests } = await pageFor(t, locale, {
      v2Booking: async (route, requests) => {
        const payload = route.request().postDataJSON();
        requests.push(payload);
        assert.equal(payload.action, "bootstrap");
        return route.fulfill({ status: 409, json: { state: "unknown" } });
      },
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    await page.goto(`${origin}/${locale}/book/browser-fixture?v2=1`);
    await page.getByRole("alert").filter({ hasText: v2LostSessionLabels[locale] }).waitFor();
    assert.equal(await page.getByRole("button", { name: uncertainLabels[locale].check }).count(), 0);
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    await page.locator("form").dispatchEvent("submit");
    assert.deepEqual(writes.map(value => value.action), ["bootstrap"]);
    assert.deepEqual(externalRequests, []);
  });
}

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} v2 bootstrap quota denial waits and retries without claiming an ambiguous booking`, async t => {
    const server = v2Server(locale);
    let denied = false;
    const { page, writes, externalRequests } = await pageFor(t, locale, {
      v2Booking: async (route, requests) => {
        const payload = route.request().postDataJSON();
        if (payload.action === "bootstrap" && !denied) {
          denied = true;
          requests.push(payload);
          return route.fulfill({ status: 429, headers: { "retry-after": "3" }, json: { state: "unknown" } });
        }
        return server.handler(route, requests);
      },
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    await page.goto(`${origin}/${locale}/book/browser-fixture?v2=1`);
    await page.getByRole("status").filter({ hasText: v2RateLimitLabels[locale].warning }).waitFor();
    const retry = page.getByRole("button", { name: v2RateLimitLabels[locale].retry, exact: true });
    assert.equal(await retry.isDisabled(), true);
    assert.equal(await page.getByText(uncertainLabels[locale].warning).count(), 0);
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    await page.locator("form").dispatchEvent("submit");
    assert.deepEqual(writes.map(value => value.action), ["bootstrap"]);
    await page.waitForFunction(label => {
      const button = [...document.querySelectorAll("button")].find(value => value.textContent?.trim() === label);
      return button && !button.disabled;
    }, v2RateLimitLabels[locale].retry);
    assert.equal(await retry.isEnabled(), true, "the stable button label remains after cooldown");
    await retry.click();
    await page.locator('[name="bookingTime"]').waitFor();
    assert.deepEqual(writes.map(value => value.action), ["bootstrap", "bootstrap", "reconcile"]);
    assert.deepEqual(externalRequests, []);
  });
}

test("v2 initial 503 with no pending marker offers safe startup retry", async t => {
  const server = v2Server("en");
  let unavailable = true;
  const { page, writes, externalRequests } = await pageFor(t, "en", {
    v2Booking: async (route, requests) => {
      const payload = route.request().postDataJSON();
      if (payload.action === "bootstrap" && unavailable) {
        unavailable = false;
        requests.push(payload);
        return route.fulfill({ status: 503, json: { state: "unknown" } });
      }
      return server.handler(route, requests);
    },
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await page.getByRole("status").filter({ hasText: "Booking recovery is temporarily unavailable" }).waitFor();
  assert.equal(await page.getByText(uncertainLabels.en.warning).count(), 0);
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.locator('[name="bookingTime"]').waitFor();
  assert.deepEqual(writes.map(value => value.action), ["bootstrap", "bootstrap", "reconcile"]);
  assert.deepEqual(externalRequests, []);
});

for (const deniedStatus of [429, 503]) {
test(`v2 ${deniedStatus} during marker reconciliation retains the marker and retries that exact intent`, async t => {
  const server = v2Server("en", { loseCommit: true });
  let denyMarkerReconcile = false;
  const { page, writes, externalRequests } = await pageFor(t, "en", {
    v2Booking: async (route, requests) => {
      const payload = route.request().postDataJSON();
      if (payload.action === "reconcile" && payload.intentId && denyMarkerReconcile) {
        denyMarkerReconcile = false;
        requests.push(payload);
        return route.fulfill({ status: deniedStatus,
          ...(deniedStatus === 429 ? { headers: { "retry-after": "1" } } : {}), json: { state: "unknown" } });
      }
      return server.handler(route, requests);
    },
    v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await waitForLostCommitToSettle(page, server);
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  assert.equal(server.appointments.size, 1, "the first commit happened before its response was lost");
  denyMarkerReconcile = true;
  await page.reload();
  await page.getByRole("alert").filter({ hasText: deniedStatus === 429
    ? v2RateLimitLabels.en.warning : "Booking recovery is temporarily unavailable" }).waitFor();
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.equal(server.appointments.size, 1, "quota denial cannot create or erase an appointment");
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))),
    [[`glowflow.booking.pending.browser-fixture.${v2IntentId}`, "1"]]);
  await page.locator("form").dispatchEvent("submit");
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  const retry = page.getByRole("button", { name: uncertainLabels.en.check });
  await retry.waitFor();
  await retry.click();
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  assert.equal(writes.filter(value => value.action === "commit").length, 1);
  assert.equal(writes.filter(value => value.action === "reconcile" && value.intentId === v2IntentId).length, 2);
  assert.equal(server.appointments.size, 1, "recovery returns the original appointment only");
  assert.deepEqual(externalRequests, []);
});
}

test("v2 prepare quota denial cannot submit a changed booking until a current-session reconcile clears it", async t => {
  const server = v2Server("en");
  let denied = false;
  const { page, writes, externalRequests } = await pageFor(t, "en", {
    v2Booking: async (route, requests) => {
      const payload = route.request().postDataJSON();
      if (payload.action === "prepare" && !denied) {
        denied = true;
        requests.push(payload);
        return route.fulfill({ status: 429, headers: { "retry-after": "1" }, json: { state: "unknown" } });
      }
      return server.handler(route, requests);
    },
    v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot, { ...slot, slot_start: "2030-01-15T11:00:00Z" }] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: v2RateLimitLabels.en.warning }).waitFor();
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.equal(server.appointments.size, 0);
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))), []);
  await page.locator("form").dispatchEvent("submit");
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  assert.equal(writes.filter(value => value.action === "commit").length, 0);
  await page.getByRole("button", { name: uncertainLabels.en.check }).click();
  await page.locator('[name="bookingTime"]').first().waitFor();
  assert.equal(writes.filter(value => value.action === "reconcile").length, 2,
    "fresh current-session reconcile must precede any new prepare");
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  await fillBooking(page, "en");
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  assert.equal(writes.filter(value => value.action === "prepare").length, 2);
  assert.equal(writes.filter(value => value.action === "commit").length, 1);
  assert.equal(server.appointments.size, 1);
  assert.deepEqual(externalRequests, []);
});

test("v2 commit 429 after save preserves exact marker and reconciles without a second commit", async t => {
  const server = v2Server("en", { commitRateLimitAfterSave: true });
  const { page, writes, externalRequests } = await pageFor(t, "en", {
    v2Booking: server.handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot, { ...slot, slot_start: "2030-01-15T11:00:00Z" }] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: v2RateLimitLabels.en.warning }).waitFor();
  assert.equal(server.appointments.size, 1);
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))),
    [[`glowflow.booking.pending.browser-fixture.${v2IntentId}`, "1"]]);
  await page.locator("form").dispatchEvent("submit");
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  assert.equal(writes.filter(value => value.action === "commit").length, 1);
  const recover = page.getByRole("button", { name: uncertainLabels.en.check });
  assert.equal(await recover.isEnabled(), true, "commit cooldown must not delay exact-intent reconcile");
  await recover.click();
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  assert.deepEqual(writes.filter(value => value.action === "reconcile" && value.intentId).map(value => value.intentId), [v2IntentId]);
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  assert.equal(writes.filter(value => value.action === "commit").length, 1);
  assert.equal(server.appointments.size, 1);
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))), []);
  assert.deepEqual(externalRequests, []);
});

test("v2 commit 429 before save reconciles immediately but never auto-retries commit", async t => {
  const server = v2Server("en");
  let denied = false;
  const handler = (route, writes) => {
    const payload = route.request().postDataJSON();
    if (payload.action === "commit" && !denied) {
      denied = true;
      writes.push(payload);
      return route.fulfill({ status: 429, headers: { "retry-after": "2" }, json: { state: "unknown" } });
    }
    return server.handler(route, writes);
  };
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: v2RateLimitLabels.en.warning }).waitFor();
  const recover = page.getByRole("button", { name: uncertainLabels.en.check });
  assert.equal(await recover.isEnabled(), true);
  await recover.click();
  await page.getByRole("alert").filter({ hasText: "This request is still pending" }).waitFor();
  assert.equal(writes.filter(value => value.action === "reconcile" && value.intentId === v2IntentId).length, 1);
  assert.equal(writes.filter(value => value.action === "commit").length, 1);
  assert.equal(server.appointments.size, 0);
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))),
    [[`glowflow.booking.pending.browser-fixture.${v2IntentId}`, "1"]]);
  await recover.click();
  assert.equal(writes.filter(value => value.action === "commit").length, 1,
    "a recovered prepared intent must not auto-commit even after cooldown");
  await page.getByRole("button", { name: "Cancel this request if it was not booked" }).click();
  await page.locator('[name="bookingTime"]').waitFor();
  assert.equal(server.appointments.size, 0);
  assert.deepEqual(externalRequests, []);
});

test("v2 cookie rejected after bootstrap cannot repeat prepare or offer recovery retry", async t => {
  const server = v2Server("en");
  const { page, writes, externalRequests } = await pageFor(t, "en", {
    v2Booking: async (route, requests) => {
      const payload = route.request().postDataJSON();
      if (payload.action === "prepare") {
        requests.push(payload);
        return route.fulfill({ status: 409, json: { state: "unknown" } });
      }
      return server.handler(route, requests);
    },
    v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: v2LostSessionLabels.en }).waitFor();
  assert.equal(await page.getByRole("button", { name: uncertainLabels.en.check }).count(), 0);
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  await page.locator("form").dispatchEvent("submit");
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  assert.equal(writes.filter(value => value.action === "commit").length, 0);
  assert.equal(server.appointments.size, 0);
  assert.deepEqual(externalRequests, []);
});

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} v2 canceled appointment warns about inactive status without claiming a lost browser session`, async t => {
    const server = v2Server(locale, { loseCommit: true, appointmentStatus: "canceled" });
    const { page, writes, externalRequests } = await pageFor(t, locale, { v2Booking: server.handler, v2Cookie: true,
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    const url = `${origin}/${locale}/book/browser-fixture?v2=1`;
    await page.goto(url);
    await fillBooking(page, locale);
    await waitForLostCommitToSettle(page, server);
    await page.getByRole("alert").filter({ hasText: uncertainLabels[locale].warning }).waitFor();
    await page.reload();
    await page.getByRole("alert").filter({ hasText: v2InactiveLabels[locale] }).waitFor();
    assert.equal(await page.getByText(v2InactiveLabels[locale], { exact: true }).count(), 1);
    assert.equal(await page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).count(), 0);
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    assert.equal(writes.filter(value => value.action === "prepare").length, 1);
    assert.equal(writes.filter(value => value.action === "commit").length, 1);
    assert.deepEqual(externalRequests, []);
  });
}

test("v2 cookie-only prepared reload stays locked without creating a new commit", async t => {
  const server = v2Server("en");
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: server.handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  const url = `${origin}/en/book/browser-fixture?v2=1`;
  await page.goto(url);
  await page.locator('[name="bookingTime"]').waitFor();
  await page.evaluate(() => localStorage.clear());
  // Model a server-side prepare that completed just before the page vanished.
  const prepared = await page.evaluate(async generation => {
    const response = await fetch("/api/public-booking/v2", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "prepare", salonSlug: "browser-fixture",
        serviceId: "11111111-1111-4111-8111-111111111111",
        staffId: "33333333-3333-4333-8333-333333333333", startTime: "2030-01-15T10:00:00Z",
        fullName: "Fictional Browser Client", phone: "", email: "browser@example.invalid", locale: "en",
        expectedGeneration: generation }),
    });
    return response.json();
  }, v2Generation);
  assert.equal(prepared.state, "prepared");
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "This request is still pending" }).waitFor();
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  await page.getByRole("button", { name: uncertainLabels.en.check }).click();
  await page.getByRole("alert").filter({ hasText: "This request is still pending" }).waitFor();
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  assert.equal(writes.filter(value => value.action === "commit").length, 0);
  assert.equal(server.appointments.size, 0);
  assert.deepEqual(externalRequests, []);
});

test("v2 local marker write failure blocks the appointment-creating commit", async t => {
  const server = v2Server("en");
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: server.handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("glowflow.booking.pending.")) throw new DOMException("Storage denied", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: "booking session was lost" }).waitFor();
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  assert.equal(writes.filter(value => value.action === "commit").length, 0);
  assert.equal(server.appointments.size, 0);
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.deepEqual(externalRequests, []);
});

test("v2 stale tab cannot prepare with the generation rotated by another tab acknowledgement", async t => {
  const server = v2Server("en");
  const { page: oldTab, context, writes, externalRequests } = await pageFor(t, "en", { v2Booking: server.handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  const url = `${origin}/en/book/browser-fixture?v2=1`;
  await oldTab.goto(url);
  await oldTab.locator('[name="bookingTime"]').waitFor();
  const bookingTab = await context.newPage();
  await bookingTab.goto(url);
  await fillBooking(bookingTab, "en");
  await bookingTab.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  await bookingTab.getByRole("button", { name: "Book another appointment" }).click();
  await bookingTab.locator('[name="bookingTime"]').waitFor();
  const stalePrepareResponse = oldTab.waitForResponse(response => response.url().endsWith("/api/public-booking/v2")
    && response.request().postDataJSON()?.action === "prepare");
  await fillBooking(oldTab, "en");
  const staleResponse = await stalePrepareResponse;
  assert.equal(staleResponse.status(), 200, "stale generation is an unknown RPC result, not a rejected cookie");
  assert.deepEqual(await staleResponse.json(), { state: "unknown" });
  await oldTab.waitForFunction(() => document.querySelector("form")?.getAttribute("aria-busy") === "false");
  await oldTab.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  assert.equal(writes.filter(value => value.action === "prepare").length, 2, "stale prepare is rejected by the server epoch");
  assert.equal(writes.filter(value => value.action === "commit").length, 1, "no second appointment-creating commit");
  assert.equal(server.appointments.size, 1);
  assert.equal(await oldTab.locator('[name="bookingTime"]').count(), 0);
  assert.deepEqual(externalRequests, []);
});

test("v2 delayed old confirmation cannot erase a newer tab's per-intent marker", async t => {
  const secondId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let generation = v2Generation;
  let oldCommitted = false;
  let oldAcknowledged = false;
  let secondPrepared = false;
  let releaseOld, releaseSecond;
  const oldBarrier = new Promise(resolve => { releaseOld = resolve; });
  const secondBarrier = new Promise(resolve => { releaseSecond = resolve; });
  const oldConfirmation = v2Confirmation("en");
  const secondConfirmation = { ...v2Confirmation("en"), appointment_id: secondId };
  const handler = async (route, writes) => {
    const payload = route.request().postDataJSON();
    writes.push(payload);
    if (payload.action === "bootstrap") return route.fulfill({ json: { ready: true, new_session: false } });
    if (payload.action === "reconcile") {
      const id = payload.intentId;
      if (id === v2IntentId || (!id && oldCommitted && !oldAcknowledged)) {
        return route.fulfill({ json: { state: "confirmed", generation: id && oldAcknowledged ? v2NextGeneration : generation,
          intent_id: v2IntentId, confirmation: oldConfirmation } });
      }
      if (id === secondId || (!id && secondPrepared)) {
        return route.fulfill({ json: { state: "prepared", generation, intent_id: secondId } });
      }
      return route.fulfill({ json: { state: "none", generation } });
    }
    if (payload.action === "prepare") {
      if (payload.expectedGeneration !== generation) return route.fulfill({ status: 409, json: { state: "unknown" } });
      if (oldAcknowledged) { secondPrepared = true; return route.fulfill({ json: { state: "prepared", generation, intent_id: secondId } }); }
      return route.fulfill({ json: { state: "prepared", generation, intent_id: v2IntentId } });
    }
    if (payload.action === "commit" && payload.intentId === v2IntentId) {
      oldCommitted = true;
      await oldBarrier;
      return route.fulfill({ json: { state: "confirmed", generation: v2Generation,
        intent_id: v2IntentId, confirmation: oldConfirmation } });
    }
    if (payload.action === "commit" && payload.intentId === secondId) {
      await secondBarrier;
      return route.fulfill({ json: { state: "confirmed", generation,
        intent_id: secondId, confirmation: secondConfirmation } });
    }
    if (payload.action === "acknowledge" && payload.intentId === v2IntentId) {
      oldAcknowledged = true;
      generation = v2NextGeneration;
      return route.fulfill({ json: { state: "none", generation } });
    }
    throw Error(`unexpected v2 action ${payload.action}`);
  };
  const { page: oldTab, context, writes, externalRequests } = await pageFor(t, "en", { v2Booking: handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  const url = `${origin}/en/book/browser-fixture?v2=1`;
  try {
    await oldTab.goto(url);
    await fillBooking(oldTab, "en");
    await oldTab.waitForFunction(() => document.querySelector("form")?.getAttribute("aria-busy") === "true");
    assert.equal(oldCommitted, true, "the first server commit happened before its response was delayed");
    const newerTab = await context.newPage();
    await newerTab.goto(url);
    await newerTab.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
    await newerTab.getByRole("button", { name: "Book another appointment" }).click();
    await newerTab.locator('[name="bookingTime"]').waitFor();
    await fillBooking(newerTab, "en");
    await newerTab.waitForFunction(() => document.querySelector("form")?.getAttribute("aria-busy") === "true");
    const newerMarker = `glowflow.booking.pending.browser-fixture.${secondId}`;
    await newerTab.waitForFunction(key => localStorage.getItem(key) === "1", newerMarker);
    releaseOld();
    await oldTab.getByRole("alert").filter({ hasText: "booking session was lost" }).waitFor();
    assert.equal(await newerTab.evaluate(key => localStorage.getItem(key), newerMarker), "1",
      "old tab may clear only its old intent marker");
    assert.equal(writes.filter(value => value.action === "commit").length, 2);
    assert.deepEqual(externalRequests, []);
  } finally {
    releaseOld();
    releaseSecond();
  }
});

test("v2 canceled intent can recover after a transient current-session reconcile failure", async t => {
  const server = v2Server("en", { loseCommit: true, commitBeforeLoss: false });
  let canceled = false;
  let failedFollowup = false;
  const handler = (route, writes) => {
    const payload = route.request().postDataJSON();
    if (payload.action === "cancel") canceled = true;
    if (canceled && !failedFollowup && payload.action === "reconcile" && !payload.intentId) {
      failedFollowup = true;
      writes.push(payload);
      return route.abort("failed");
    }
    return server.handler(route, writes);
  };
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await waitForLostCommitToSettle(page, server);
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  await page.getByRole("button", { name: "Cancel this request if it was not booked" }).click();
  await page.waitForFunction(() => document.querySelector("form")?.getAttribute("aria-busy") === "false");
  assert.equal(failedFollowup, true);
  assert.equal(server.getState(), "not_committed");
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  await page.getByRole("button", { name: uncertainLabels.en.check }).click();
  await page.locator('[name="bookingTime"]').waitFor();
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  assert.equal(writes.filter(value => value.action === "commit").length, 1);
  assert.equal(server.appointments.size, 0);
  assert.deepEqual(externalRequests, []);
});

test("v2 failed acknowledgement keeps confirmation visible with readable dark-mode recovery error", async t => {
  const server = v2Server("en");
  const handler = (route, writes) => {
    const payload = route.request().postDataJSON();
    if (payload.action === "acknowledge") {
      writes.push(payload);
      return route.fulfill({ status: 503, json: { state: "unknown" } });
    }
    return server.handler(route, writes);
  };
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  const again = page.getByRole("button", { name: "Book another appointment" });
  await again.click();
  const alert = page.getByRole("alert").filter({ hasText: "A new request could not be opened" });
  await alert.waitFor();
  assert.equal(await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).count(), 1);
  assert.equal(writes.filter(value => value.action === "prepare").length, 1);
  const contrast = await alert.evaluate(element => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    const luminance = color => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
        const unit = value / 255;
        return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(element.closest("section")).backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  assert.ok(contrast >= 4.5, `dark-mode recovery text must reach 4.5:1 contrast, got ${contrast}`);
  await again.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  assert.equal(await again.evaluate(element => document.activeElement === element), true);
  assert.notEqual(await again.evaluate(element => getComputedStyle(element).outlineStyle), "none");
  assert.deepEqual(externalRequests, []);
});

test("v2 acknowledge 429 keeps confirmation and waits before opening another booking", async t => {
  const server = v2Server("en");
  let denied = false;
  const handler = (route, writes) => {
    const payload = route.request().postDataJSON();
    if (payload.action === "acknowledge" && !denied) {
      denied = true;
      writes.push(payload);
      return route.fulfill({ status: 429, headers: { "retry-after": "2" }, json: { state: "unknown" } });
    }
    return server.handler(route, writes);
  };
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  const again = page.getByRole("button", { name: "Book another appointment" });
  await again.click();
  await page.getByRole("alert").filter({ hasText: "Wait before opening another booking" }).waitFor();
  assert.equal(await again.isDisabled(), true);
  await again.dispatchEvent("click");
  assert.equal(writes.filter(value => value.action === "acknowledge").length, 1);
  assert.equal(await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).count(), 1);
  assert.equal(server.appointments.size, 1);
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(value => value.textContent?.trim() === "Book another appointment");
    return button && !button.disabled;
  });
  await again.click();
  await page.locator('[name="bookingTime"]').waitFor();
  assert.equal(writes.filter(value => value.action === "acknowledge").length, 2);
  assert.equal(server.appointments.size, 1);
  assert.deepEqual(externalRequests, []);
});

test("v2 reconcile 429 after successful acknowledgement retries reconciliation only", async t => {
  const server = v2Server("en");
  let acknowledged = false;
  let deniedReconcile = false;
  const handler = (route, writes) => {
    const payload = route.request().postDataJSON();
    if (payload.action === "acknowledge") acknowledged = true;
    if (acknowledged && payload.action === "reconcile" && !payload.intentId && !deniedReconcile) {
      deniedReconcile = true;
      writes.push(payload);
      return route.fulfill({ status: 429, headers: { "retry-after": "2" }, json: { state: "unknown" } });
    }
    return server.handler(route, writes);
  };
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  const again = page.getByRole("button", { name: "Book another appointment" });
  await again.click();
  await page.getByRole("alert").filter({ hasText: "Wait before opening another booking" }).waitFor();
  assert.equal(await again.isDisabled(), true);
  assert.equal(writes.filter(value => value.action === "acknowledge").length, 1);
  await again.dispatchEvent("click");
  assert.equal(writes.filter(value => value.action === "acknowledge").length, 1);
  assert.equal(await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).count(), 1);
  await page.waitForTimeout(2100);
  await again.click();
  await page.locator('[name="bookingTime"]').waitFor();
  assert.equal(writes.filter(value => value.action === "acknowledge").length, 1,
    "a successful acknowledgement must never be reposted for a denied follow-up reconcile");
  assert.equal(server.appointments.size, 1);
  assert.deepEqual(externalRequests, []);
});

test("v2 cancel 429 keeps the exact pending intent and waits before retry", async t => {
  const server = v2Server("en", { loseCommit: true, commitBeforeLoss: false });
  let denied = false;
  const handler = (route, writes) => {
    const payload = route.request().postDataJSON();
    if (payload.action === "cancel" && !denied) {
      denied = true;
      writes.push(payload);
      return route.fulfill({ status: 429, headers: { "retry-after": "2" }, json: { state: "unknown" } });
    }
    return server.handler(route, writes);
  };
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  const cancel = page.getByRole("button", { name: "Cancel this request if it was not booked" });
  await cancel.click();
  await page.getByRole("alert").filter({ hasText: v2RateLimitLabels.en.warning }).waitFor();
  assert.equal(await cancel.isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))),
    [[`glowflow.booking.pending.browser-fixture.${v2IntentId}`, "1"]]);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), `glowflow.booking.cancel.browser-fixture.${v2IntentId}`), "1");
  await cancel.dispatchEvent("click");
  assert.equal(writes.filter(value => value.action === "cancel").length, 1);
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  const recover = page.getByRole("button", { name: uncertainLabels.en.check });
  assert.equal(await recover.isEnabled(), true, "cancel cooldown must not block reconciliation");
  await recover.click();
  await page.getByRole("alert").filter({ hasText: "Cancellation is not confirmed" }).waitFor();
  assert.equal(writes.filter(value => value.action === "commit").length, 1,
    "reconciling a prepared intent after cancel denial must not commit it");
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "Cancellation is not confirmed" }).waitFor();
  await page.getByRole("button", { name: uncertainLabels.en.check }).click();
  assert.equal(writes.filter(value => value.action === "commit").length, 1,
    "the persisted cancel choice must survive reload without auto-commit");
  // The browser cooldown is advisory across reloads; the server quota is authoritative.
  await page.waitForTimeout(2100);
  await page.getByRole("button", { name: "Cancel this request if it was not booked" }).click();
  await page.locator('[name="bookingTime"]').waitFor();
  assert.equal(writes.filter(value => value.action === "cancel").length, 2);
  assert.equal(server.appointments.size, 0);
  assert.deepEqual(externalRequests, []);
});

test("v2 cancel transport failure before mutation never auto-commits on reload", async t => {
  const server = v2Server("en", { loseCommit: true, commitBeforeLoss: false });
  let lostCancel = false;
  const handler = (route, writes) => {
    const payload = route.request().postDataJSON();
    if (payload.action === "cancel" && !lostCancel) {
      lostCancel = true;
      writes.push(payload);
      return route.abort("failed");
    }
    return server.handler(route, writes);
  };
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  await page.getByRole("button", { name: "Cancel this request if it was not booked" }).click();
  await page.waitForFunction(() => document.querySelector("form")?.getAttribute("aria-busy") === "false");
  assert.equal(server.getState(), "prepared");
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))),
    [[`glowflow.booking.pending.browser-fixture.${v2IntentId}`, "1"]]);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), `glowflow.booking.cancel.browser-fixture.${v2IntentId}`), "1");
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "Cancellation is not confirmed" }).waitFor();
  await page.getByRole("button", { name: uncertainLabels.en.check }).click();
  assert.equal(writes.filter(value => value.action === "commit").length, 1);
  assert.equal(server.appointments.size, 0);
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.deepEqual(externalRequests, []);
});

test("v2 failed cancel-marker write cannot turn prepared recovery into a booking", async t => {
  const server = v2Server("en", { loseCommit: true, commitBeforeLoss: false });
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: server.handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("glowflow.booking.cancel.")) throw new DOMException("fixture quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Cancel this request if it was not booked" }).click();
  await page.getByRole("alert").filter({ hasText: v2LostSessionLabels.en }).waitFor();
  assert.equal(writes.filter(value => value.action === "cancel").length, 0,
    "failed durable cancel choice must prevent the cancel request");
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))),
    [[`glowflow.booking.pending.browser-fixture.${v2IntentId}`, "1"]]);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), `glowflow.booking.cancel.browser-fixture.${v2IntentId}`), null);
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "This request is still pending" }).waitFor();
  await page.getByRole("button", { name: uncertainLabels.en.check }).click();
  assert.equal(writes.filter(value => value.action === "commit").length, 1,
    "recovery must not commit even when the cancel choice could not be stored");
  assert.equal(server.appointments.size, 0);
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.deepEqual(externalRequests, []);
});

test("v2 another tab cancel marker cannot be overwritten by pending-marker creation", async t => {
  const server = v2Server("en");
  let otherTab;
  const handler = async (route, writes) => {
    const payload = route.request().postDataJSON();
    if (payload.action === "prepare") {
      await otherTab.evaluate(key => localStorage.setItem(key, "1"),
        `glowflow.booking.cancel.browser-fixture.${v2IntentId}`);
    }
    return server.handler(route, writes);
  };
  const { page, context, writes, externalRequests } = await pageFor(t, "en", { v2Booking: handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  otherTab = await context.newPage();
  await otherTab.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await otherTab.locator('[name="bookingTime"]').waitFor();
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: "Cancellation is not confirmed" }).waitFor();
  assert.equal(writes.filter(value => value.action === "commit").length, 0);
  assert.equal(server.appointments.size, 0);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), `glowflow.booking.pending.browser-fixture.${v2IntentId}`), "1");
  assert.equal(await page.evaluate(key => localStorage.getItem(key), `glowflow.booking.cancel.browser-fixture.${v2IntentId}`), "1");
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "Cancellation is not confirmed" }).waitFor();
  await page.getByRole("button", { name: uncertainLabels.en.check }).click();
  assert.equal(writes.filter(value => value.action === "commit").length, 0);
  assert.deepEqual(externalRequests, []);
});

test("v2 cancel response lost after definitive non-commit recovers without a booking", async t => {
  const server = v2Server("en", { loseCommit: true, commitBeforeLoss: false, loseCancel: true });
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: server.handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  await page.getByRole("button", { name: "Cancel this request if it was not booked" }).click();
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  assert.equal(server.getState(), "not_committed");
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))),
    [[`glowflow.booking.pending.browser-fixture.${v2IntentId}`, "1"]]);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), `glowflow.booking.cancel.browser-fixture.${v2IntentId}`), "1");
  await page.reload();
  await page.locator('[name="bookingTime"]').waitFor();
  assert.equal(writes.filter(value => value.action === "commit").length, 1);
  assert.equal(server.appointments.size, 0);
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))), []);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), `glowflow.booking.cancel.browser-fixture.${v2IntentId}`), null);
  assert.deepEqual(externalRequests, []);
});

test("v2 cancel after the original commit preserves its one confirmed appointment", async t => {
  const server = v2Server("en", { loseCommit: true });
  const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: server.handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  await page.goto(`${origin}/en/book/browser-fixture?v2=1`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: uncertainLabels.en.warning }).waitFor();
  await page.getByRole("button", { name: "Cancel this request if it was not booked" }).click();
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  assert.equal(writes.filter(value => value.action === "commit").length, 1);
  assert.equal(server.appointments.size, 1);
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))), []);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), `glowflow.booking.cancel.browser-fixture.${v2IntentId}`), null);
  assert.deepEqual(externalRequests, []);
});

async function offerOriginalFinish(page, server, locale = "en") {
  await page.goto(`${origin}/${locale}/book/browser-fixture?v2=1`);
  await fillBooking(page, locale);
  await waitForLostCommitToSettle(page, server);
  await page.getByRole("button", { name: uncertainLabels[locale].check }).click();
  const finish = page.getByRole("button", { name: v2FinishLabels[locale].finish });
  await finish.waitFor();
  return finish;
}

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} v2 explicit Finish saves once despite a lost response, then Check confirms`, async t => {
    const server = v2Server(locale, { loseCommit: true, commitBeforeLoss: false, loseSecondCommitAfterSave: true });
    const { page, writes, externalRequests } = await pageFor(t, locale, { v2Booking: server.handler, v2Cookie: true,
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    const finish = await offerOriginalFinish(page, server, locale);
    assert.equal(server.appointments.size, 0, "the original lost commit did not book");
    assert.equal(writes.filter(value => value.action === "commit").length, 1);
    await finish.click();
    await page.getByRole("alert").filter({ hasText: uncertainLabels[locale].warning }).waitFor();
    await page.waitForFunction(() => document.querySelector("form")?.getAttribute("aria-busy") === "false");
    assert.equal(server.appointments.size, 1, "the explicit Finish committed before its response was lost");
    assert.deepEqual([...server.appointments.keys()], [v2IntentId]);
    assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))),
      [[`glowflow.booking.pending.browser-fixture.${v2IntentId}`, "1"]]);
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0, "an uncertain Finish cannot expose another time");
    assert.equal(await page.getByRole("button", { name: v2FinishLabels[locale].finish }).count(), 0,
      "the failed response cannot silently offer another commit");
    await page.locator("form").dispatchEvent("submit");
    assert.equal(writes.filter(value => value.action === "prepare").length, 1);
    assert.equal(writes.filter(value => value.action === "commit").length, 2);
    await page.getByRole("button", { name: uncertainLabels[locale].check }).click();
    await page.getByRole("heading", { name: confirmationLabels[locale].success, exact: true }).waitFor();
    assert.equal(writes.filter(value => value.action === "prepare").length, 1,
      "read-only Check must not prepare another appointment");
    assert.equal(writes.filter(value => value.action === "commit").length, 2,
      "read-only Check must not retry the saved Finish commit");
    assert.equal(server.appointments.size, 1);
    assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("glowflow.booking.pending."))), []);
    assert.deepEqual(externalRequests, []);
  });
}

test("v2 explicit finish rechecks a cancel marker written by another tab during reconciliation", async t => {
  const server = v2Server("en", { loseCommit: true, commitBeforeLoss: false });
  let exactReconciles = 0;
  let releaseFinish;
  let reachFinish;
  const finishReached = new Promise(resolve => { reachFinish = resolve; });
  const finishGate = new Promise(resolve => { releaseFinish = resolve; });
  const handler = async (route, requests) => {
    const payload = route.request().postDataJSON();
    if (payload.action === "reconcile" && payload.intentId === v2IntentId && ++exactReconciles === 2) {
      requests.push(payload);
      reachFinish();
      await finishGate;
      return route.fulfill({ json: { state: "prepared", generation: v2Generation, intent_id: v2IntentId } });
    }
    return server.handler(route, requests);
  };
  const { page, context, writes, externalRequests } = await pageFor(t, "en", { v2Booking: handler, v2Cookie: true,
    publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
  });
  const finish = await offerOriginalFinish(page, server);
  const otherTab = await context.newPage();
  await otherTab.goto(`${origin}/en/book/browser-fixture`);
  const finishing = finish.click();
  await finishReached;
  await otherTab.evaluate(key => localStorage.setItem(key, "1"), `glowflow.booking.cancel.browser-fixture.${v2IntentId}`);
  releaseFinish();
  await finishing;
  await page.getByRole("alert").filter({ hasText: "Cancellation is not confirmed" }).waitFor();
  assert.equal(writes.filter(value => value.action === "commit").length, 1);
  assert.equal(server.appointments.size, 0);
  assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
  assert.deepEqual(externalRequests, []);
});

for (const authoritativeState of ["not_committed", "confirmed"]) {
  test(`v2 explicit finish accepts authoritative ${authoritativeState} without another commit`, async t => {
    const server = v2Server("en", { loseCommit: true, commitBeforeLoss: false });
    let finishStarted = false;
    const handler = (route, requests) => {
      const payload = route.request().postDataJSON();
      if (finishStarted && payload.action === "reconcile") {
        requests.push(payload);
        if (!payload.intentId) return route.fulfill({ json: { state: "none", generation: v2NextGeneration } });
        return route.fulfill({ json: authoritativeState === "confirmed"
          ? { state: "confirmed", generation: v2Generation, intent_id: v2IntentId, confirmation: v2Confirmation("en") }
          : { state: "not_committed", generation: v2NextGeneration, intent_id: v2IntentId } });
      }
      return server.handler(route, requests);
    };
    const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: handler, v2Cookie: true,
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    const finish = await offerOriginalFinish(page, server);
    finishStarted = true;
    await finish.click();
    if (authoritativeState === "confirmed") {
      await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
      await page.getByText("Booked service", { exact: true }).waitFor();
    } else {
      await page.locator('[name="bookingTime"]').waitFor();
      assert.equal(await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).count(), 0);
    }
    assert.equal(writes.filter(value => value.action === "commit").length, 1);
    assert.equal(writes.filter(value => value.action === "prepare").length, 1);
    assert.equal(await page.getByRole("button", { name: v2FinishLabels.en.finish }).count(), 0);
    assert.deepEqual(externalRequests, []);
  });
}

for (const failure of ["pending marker write", "cancel marker read"]) {
  test(`v2 explicit finish ${failure} failure locks exact intent without a commit`, async t => {
    const server = v2Server("en", { loseCommit: true, commitBeforeLoss: false });
    const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: server.handler, v2Cookie: true,
      publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
    });
    const finish = await offerOriginalFinish(page, server);
    await page.evaluate(mode => {
      if (mode === "pending marker write") {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith("glowflow.booking.pending.")) throw new DOMException("fixture quota", "QuotaExceededError");
          return original.call(this, key, value);
        };
      } else {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (key.startsWith("glowflow.booking.cancel.")) throw new DOMException("fixture blocked", "SecurityError");
          return original.call(this, key);
        };
      }
    }, failure);
    await finish.click();
    await page.getByRole("alert").filter({ hasText: v2LostSessionLabels.en }).waitFor();
    assert.equal(writes.filter(value => value.action === "commit").length, 1);
    assert.equal(writes.filter(value => value.action === "reconcile").length, 2,
      "failed local marker validation must block even the Finish reconciliation");
    assert.equal(server.appointments.size, 0);
    assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
    assert.deepEqual(externalRequests, []);
  });
}

for (const deniedAction of ["reconcile", "commit"]) {
  for (const status of [429, 503]) {
    test(`v2 explicit finish ${deniedAction} ${status} keeps the original intent locked`, async t => {
      const server = v2Server("en", { loseCommit: true, commitBeforeLoss: false });
      let finishStarted = false;
      const handler = (route, requests) => {
        const payload = route.request().postDataJSON();
        if (finishStarted && payload.action === deniedAction) {
          requests.push(payload);
          return route.fulfill({ status, headers: status === 429 ? { "retry-after": "2" } : {}, json: { state: "unknown" } });
        }
        return server.handler(route, requests);
      };
      const { page, writes, externalRequests } = await pageFor(t, "en", { v2Booking: handler, v2Cookie: true,
        publicBooking: async route => route.fulfill({ json: { slots: [slot] } }),
      });
      const finish = await offerOriginalFinish(page, server);
      finishStarted = true;
      await finish.click();
      await page.getByRole("alert").filter({ hasText: status === 429 ? v2RateLimitLabels.en.warning : "Booking recovery is temporarily unavailable" }).waitFor();
      assert.equal(writes.filter(value => value.action === "commit").length, deniedAction === "commit" ? 2 : 1);
      assert.equal(writes.filter(value => value.action === "prepare").length, 1);
      assert.equal(server.appointments.size, 0);
      assert.equal(await page.locator('[name="bookingTime"]').count(), 0);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), `glowflow.booking.pending.browser-fixture.${v2IntentId}`), "1");
      await page.locator("form").dispatchEvent("submit");
      assert.equal(writes.filter(value => value.action === "prepare").length, 1,
        "a denied exact-intent Finish must not permit a changed submission");
      assert.deepEqual(externalRequests, []);
    });
  }
}

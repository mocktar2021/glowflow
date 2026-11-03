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
async function pageFor(t, locale = "fr", { status = "pending", unavailable = false, delay = false, publicBooking = null, timeZoneId, postCheckoutUrl = null, statusCheckoutUrl = "https://checkout.stripe.com/c/pay/cs_test_fixture" } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale, timeZoneId });
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
  return { page, writes, externalRequests, setStatus: value => state = value, setUnavailable: value => unavailableState = value, release };
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

test("ambiguous public booking failure retries the same request key", async t => {
  const { page, writes, externalRequests } = await pageFor(t, "fr", { publicBooking: async (route, requests) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot] } });
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) return route.abort("failed");
    return route.fulfill({ status: 201, json: { confirmation: confirmedBooking("fr") } });
  } });
  await page.goto(`${origin}/fr/book/browser-fixture`);
  await fillBooking(page, "fr");
  await page.getByRole("alert").filter({ hasText: "La réservation a échoué" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: confirmationLabels.fr.success, exact: true }).count(), 0);
  await page.getByRole("button", { name: confirmationLabels.fr.submit, exact: true }).click();
  await page.getByRole("heading", { name: confirmationLabels.fr.success, exact: true }).waitFor();
  assert.equal(writes.length, 2);
  assert.match(writes[0].requestKey, /^[0-9a-f-]{36}$/);
  assert.deepEqual(writes[1], writes[0], "an uncertain first result must reuse its idempotency key and payload");
  assert.deepEqual(externalRequests, []);
});

test("changed contact after an ambiguous public booking response gets a new request key", async t => {
  const { page, writes, externalRequests } = await pageFor(t, "en", { publicBooking: async (route, requests) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { slots: [slot] } });
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) return route.abort("failed");
    return route.fulfill({ status: 201, json: { confirmation: confirmedBooking("en") } });
  } });
  await page.goto(`${origin}/en/book/browser-fixture`);
  await fillBooking(page, "en");
  await page.getByRole("alert").filter({ hasText: "Booking failed. Review your information." }).waitFor();
  assert.equal(writes.length, 1);
  assert.equal(await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).count(), 0);

  await selectBookingTime(page);
  await page.locator('[name="email"]').fill("updated@example.invalid");
  await page.getByRole("button", { name: confirmationLabels.en.submit, exact: true }).click();
  await page.getByRole("heading", { name: confirmationLabels.en.success, exact: true }).waitFor();
  assert.equal(writes.length, 2);
  const { requestKey: firstKey, ...firstPayload } = writes[0];
  const { requestKey: secondKey, ...secondPayload } = writes[1];
  assert.match(firstKey, /^[0-9a-f-]{36}$/);
  assert.match(secondKey, /^[0-9a-f-]{36}$/);
  assert.notEqual(secondKey, firstKey, "changed contact details cannot reuse an ambiguous reservation key");
  assert.deepEqual(secondPayload, { ...firstPayload, email: "updated@example.invalid" });
  assert.deepEqual(externalRequests, []);
});

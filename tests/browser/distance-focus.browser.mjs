import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const { chromium } = await import(process.env.GLOWFLOW_PLAYWRIGHT_PATH ? pathToFileURL(process.env.GLOWFLOW_PLAYWRIGHT_PATH).href : "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = path.join(root, "tests/browser/fixture");
let server, browser, origin;
let output = "";

before(async () => {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SUPABASE|STRIPE|GLOWFLOW_APP|VERCEL/.test(key)));
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: fixture, env: { ...env, NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk_fixture", NEXT_TELEMETRY_DISABLED: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
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
}, { timeout: 150000 });

after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) server.kill("SIGTERM");
});

for (const [locale, actionText, clearText] of [
  ["fr", "Trier près de moi", "Arrêter le tri par distance"],
  ["en", "Sort near me", "Stop distance sorting"],
  ["es", "Ordenar cerca de mí", "Dejar de ordenar por distancia"],
]) test(`${locale} mobile distance controls show keyboard focus before location permission`, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.addInitScript(() => Object.defineProperty(navigator, "geolocation", {
      configurable: true, value: { getCurrentPosition() { /* Hold permission response: no location or RPC is sent. */ } },
    }));
    await page.goto(`${origin}/${locale}/book/browser-fixture?distanceFocus=1`);
    const action = page.getByRole("button", { name: actionText });
    await action.waitFor();
    await page.locator('[data-distance-focus-hydrated="true"]').waitFor();
    await page.keyboard.press("Tab");
    assert.equal(await action.evaluate(node => node === document.activeElement), true);
    const actionOutline = await action.evaluate(node => ({ style: getComputedStyle(node).outlineStyle, width: getComputedStyle(node).outlineWidth }));
    assert.deepEqual(actionOutline, { style: "solid", width: "2px" });
    await page.keyboard.press("Enter");
    const clear = page.getByRole("button", { name: clearText });
    await clear.waitFor();
    await page.keyboard.press("Tab");
    assert.equal(await clear.evaluate(node => node === document.activeElement), true);
    const clearOutline = await clear.evaluate(node => ({ style: getComputedStyle(node).outlineStyle, width: getComputedStyle(node).outlineWidth }));
    assert.deepEqual(clearOutline, { style: "solid", width: "2px" });
    await clear.press("Enter");
    assert.equal(await action.isEnabled(), true);
    assert.equal(await page.getByText("Existing results").count(), 1, "manual results remain visible");
  } finally { await context.close(); }
});

for (const [locale, actionText, nextText, firstStatus, secondStatus] of [
  ["fr", "Trier près de moi", "Suivant", "2 salons trouvés. Page 1 sur 2.", "2 salons trouvés. Page 2 sur 2."],
  ["en", "Sort near me", "Next", "2 salons found. Page 1 of 2.", "2 salons found. Page 2 of 2."],
  ["es", "Ordenar cerca de mí", "Siguiente", "2 salones encontrados. Página 1 de 2.", "2 salones encontrados. Página 2 de 2."],
]) test(`${locale} mobile keyboard pagination announces only the new nearby page`, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const offsets = [];
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route("**/rest/v1/rpc/search_public_salons_by_distance*", async route => {
      const offset = route.request().postDataJSON().page_offset;
      offsets.push(offset);
      const number = offset + 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{
        slug: `fixture-${number}`, business_name: `Fixture Salon ${number}`, description_json: {},
        country_code: "US", city: "Fixture", postal_code: "00000", categories: [], product_keywords: [],
        image_url: null, next_available_at: null, starting_price: null, currency: "USD",
        total_count: 2, distance_meters: number * 100,
      }]) });
    });
    await page.route("**/rest/v1/salon_public_profiles*", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.addInitScript(() => Object.defineProperty(navigator, "geolocation", {
      configurable: true, value: { getCurrentPosition(success) { success({ coords: { latitude: 36.0726, longitude: -79.7915 } }); } },
    }));
    await page.goto(`${origin}/${locale}/book/browser-fixture?distanceAnnouncement=1`);
    await page.locator('[data-distance-focus-hydrated="true"]').waitFor();
    const action = page.getByRole("button", { name: actionText });
    await action.focus();
    await page.keyboard.press("Enter");
    await page.getByText("Fixture Salon 1").waitFor();
    const live = page.getByRole("status");
    assert.equal(await live.count(), 1, "one polite live region prevents duplicate announcements");
    assert.equal(await live.getAttribute("aria-atomic"), "true");
    assert.equal(await live.textContent(), firstStatus);

    const next = page.getByRole("button", { name: nextText });
    await next.focus();
    await page.keyboard.press("Enter");
    await page.getByText("Fixture Salon 2").waitFor();
    assert.deepEqual(offsets, [0, 1], "only local synthetic pages were requested");
    assert.equal(await live.count(), 1);
    assert.equal(await live.textContent(), secondStatus);
    assert.equal(await page.getByRole("navigation").getByText(/\b2\s*\/\s*2\b/).count(), 1, "visual pager is unchanged");
  } finally { await context.close(); }
});

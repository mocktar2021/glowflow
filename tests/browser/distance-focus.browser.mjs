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
    cwd: fixture, env: { ...env, NEXT_TELEMETRY_DISABLED: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
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

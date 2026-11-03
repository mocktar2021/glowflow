import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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
  origin = "http://127.0.0.1:" + port;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SUPABASE|STRIPE|GLOWFLOW_APP|VERCEL/.test(key)));
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: fixture, env: { ...env, NEXT_TELEMETRY_DISABLED: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", value => output += value);
  server.stderr.on("data", value => output += value);
  const deadline = Date.now() + 120000;
  while (true) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(10000) });
      if (response.ok) break;
    } catch { /* Startup is still in progress. */ }
    if (Date.now() > deadline) throw new Error("Fixture failed to start: " + output);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.GLOWFLOW_CHROMIUM_PATH || undefined });
}, { timeout: 150000 });

after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) server.kill("SIGTERM");
});

for (const [locale, label] of [
  ["fr", "Aller aux résultats"],
  ["en", "Skip to results"],
  ["es", "Ir a los resultados"],
]) test(locale + " location skip link moves keyboard focus to results", async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const errors = [], mutations = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin) return route.abort();
      if (!["GET", "HEAD"].includes(request.method())) {
        mutations.push(request.url());
        return route.abort();
      }
      return route.continue();
    });

    const response = await page.goto(origin + "/" + locale + "/salons/locations/US");
    assert.equal(response.status(), 200);
    const skip = page.getByRole("link", { name: label, exact: true });
    await skip.waitFor();
    await page.keyboard.press("Tab");
    assert.equal(await skip.evaluate(node => node === document.activeElement), true, "first Tab reaches the skip link");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "location-results");
    assert.equal(new URL(page.url()).hash, "#location-results");
    assert.equal(await page.locator("#location-results").getAttribute("tabindex"), "-1");
    assert.deepEqual(errors, [], "no browser runtime errors");
    assert.deepEqual(mutations, [], "no write requests");
  } finally {
    await context.close();
  }
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { authCopy } from "../../lib/auth-copy.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
let server;
let browser;
let origin;
let output = "";

before(async () => {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SUPABASE|STRIPE|GLOWFLOW_APP|VERCEL/.test(key)));
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root, env: { ...env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (value) => { output += value; });
  server.stderr.on("data", (value) => { output += value; });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      const response = await fetch(`${origin}/fr/register`, { signal: AbortSignal.timeout(10000) });
      if (response.ok) break;
    } catch { /* Waiting for the local development server. */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (Date.now() >= deadline) throw new Error(`Registration server did not start: ${output}`);
  browser = await chromium.launch({ headless: true, executablePath: process.env.GLOWFLOW_CHROMIUM_PATH || undefined });
}, { timeout: 150000 });

after(async () => {
  await browser?.close();
  if (server?.exitCode === null) server.kill("SIGTERM");
});

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} owner registration progresses without submitting or losing account fields`, async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const mutations = [];
    await context.route("**/*", (route) => {
      const request = route.request();
      if (!["GET", "HEAD"].includes(request.method())) {
        mutations.push(request.url());
        return route.abort();
      }
      return route.continue();
    });
    try {
      const copy = authCopy[locale].register;
      await page.goto(`${origin}/${locale}/register`);
      await page.getByRole("heading", { name: copy.accountStep, exact: true }).waitFor();
      await page.getByRole("button", { name: copy.continue }).click();
      assert.equal(await page.getByRole("heading", { name: copy.salonStep, exact: true }).count(), 0, "invalid first step stays visible");
      await page.locator('input[name="full_name"]').fill("Salon Owner");
      await page.locator('input[name="email"]').fill("owner@example.invalid");
      await page.locator('input[name="password"]').fill("example-secret-123");
      await page.getByRole("button", { name: copy.continue }).click();
      await page.getByRole("heading", { name: copy.salonStep, exact: true }).waitFor();
      assert.equal(await page.locator('input[name="full_name"]').isVisible(), false);
      await page.locator('input[name="salon_name"]').fill("Example Salon");
      await page.getByRole("button", { name: copy.back }).click();
      await page.getByRole("heading", { name: copy.accountStep, exact: true }).waitFor();
      assert.equal(await page.locator('input[name="email"]').inputValue(), "owner@example.invalid");
      await page.locator('input[name="password"]').press("Enter");
      assert.equal(await page.locator('input[name="salon_name"]').inputValue(), "Example Salon");
      await page.locator('select[name="country_code"]').selectOption("FR");
      await page.locator('input[name="address_line1"]').fill("10 Rue Exemple");
      await page.locator('input[name="city"]').fill("Paris");
      await page.locator('input[name="postal_code"]').fill("75001");
      await page.evaluate(() => {
        window.__registrationSubmitted = false;
        document.querySelector("form").addEventListener("submit", (event) => {
          event.preventDefault();
          event.stopPropagation();
          window.__registrationSubmitted = true;
        }, { capture: true });
      });
      await page.getByRole("button", { name: copy.submit }).click();
      await page.waitForFunction(() => window.__registrationSubmitted);
      assert.deepEqual(mutations, []);
    } finally {
      await context.close();
    }
  });
}

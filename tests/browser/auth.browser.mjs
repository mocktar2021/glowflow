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
const artifacts = path.join(root, "test-results/browser/auth");
let server, browser, origin;
let output = "";
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
async function contextFor(t, locale, identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale });
  if (identity) await context.addCookies([{ name: "fixture-identity", value: identity, url: origin }]);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(90000);
  const errors = [], mutations = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /hydrat|server rendered HTML/i.test(message.text())) errors.push(message.text()); });
  await context.route("**/*", route => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin) return route.abort();
    if (!["GET", "HEAD"].includes(request.method())) {
      mutations.push(request.url());
      return route.abort();
    }
    return route.continue();
  });
  t.after(async () => {
    try {
      await page.screenshot({ path: path.join(artifacts, `${t.name.replace(/[^a-z0-9-]/gi, "-")}.png`), fullPage: true });
      assert.deepEqual(errors, [], "no runtime/hydration errors");
      assert.deepEqual(mutations, [], "owner preview must not mutate data or send messages");
    } finally { await context.close(); }
  });
  return { context, page };
}
const headings = { fr: "Rendez-vous confirmé", en: "Appointment confirmed", es: "Cita confirmada" };
for (const locale of ["fr", "en", "es"]) {
  test(`${locale} production notification route renders for fixture owner then redirects after sign-out`, async t => {
    const { context, page } = await contextFor(t, locale, "owner");
    const response = await page.goto(`${origin}/${locale}/dashboard/notifications`);
    assert.equal(response.status(), 200);
    await page.getByRole("status").filter({ hasText: headings[locale] }).waitFor();
    await page.locator("#notification-kind").selectOption("reminder2h");
    await page.locator("#notification-client").selectOption("es");
    await page.getByRole("status").filter({ hasText: "Recordatorio de cita — 2 horas" }).waitFor();
    await context.clearCookies();
    await page.reload();
    await page.waitForURL(`${origin}/${locale}/login`);
    await page.getByRole("heading", { name: "Fixture login destination" }).waitFor();
    assert.equal(await page.locator("#notification-kind").count(), 0);
  });
  for (const identity of [null, "staff", "cross-tenant", "query-error"]) {
    test(`${locale} production notification route denies fixture ${identity || "anonymous"}`, async t => {
      const { page } = await contextFor(t, locale, identity);
      await page.goto(`${origin}/${locale}/dashboard/notifications?tenantId=tenant-b&owner_id=owner-b`);
      const destination = identity ? "dashboard" : "login";
      await page.waitForURL(`${origin}/${locale}/${destination}`);
      await page.getByRole("heading", { name: `Fixture ${destination} destination` }).waitFor();
      assert.equal(await page.locator("#notification-kind").count(), 0);
      assert.equal(await page.getByText("Fictional database diagnostic").count(), 0);
    });
  }
}
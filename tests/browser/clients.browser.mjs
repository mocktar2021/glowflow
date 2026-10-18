import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const { chromium } = await import(process.env.GLOWFLOW_PLAYWRIGHT_PATH ? pathToFileURL(process.env.GLOWFLOW_PLAYWRIGHT_PATH).href : "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = path.join(root, "tests/browser/fixture");
const clientId = "30000000-0000-0000-0000-000000000001";
const foreignId = "30000000-0000-0000-0000-000000000002";
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

async function pageFor(identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (identity) await context.addCookies([{ name: "fixture-identity", value: identity, url: origin }]);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(90000);
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  return { context, page };
}

for (const [locale, title, search, history] of [
  ["fr", "Clients", "Rechercher", "Rendez-vous récents"],
  ["en", "Clients", "Search", "Recent appointments"],
  ["es", "Clientes", "Buscar", "Citas recientes"],
]) {
  for (const identity of ["owner", "staff"]) test(`${locale} ${identity} can search and read their own synthetic client`, async () => {
    const { context, page } = await pageFor(identity);
    try {
      const response = await page.goto(`${origin}/${locale}/dashboard/clients`);
      assert.equal(response.status(), 200);
      await page.getByRole("heading", { name: title, exact: true, level: 1 }).waitFor();
      await page.getByRole("searchbox").fill("alice@example.invalid");
      await page.getByRole("button", { name: search, exact: true }).click();
      await page.getByRole("link", { name: /Synthetic Alice/ }).waitFor();
      await page.getByRole("link", { name: /Fixture Client/ }).waitFor({ state: "detached" });
      assert.equal(await page.getByRole("link", { name: /Fixture Client/ }).count(), 0);
      assert.equal(new URL(page.url()).search, "", "contact search stays out of the URL");
      await page.goto(`${origin}/${locale}/dashboard/clients/${clientId}`);
      await page.getByRole("heading", { name: "Synthetic Alice" }).waitFor();
      await page.getByRole("heading", { name: history }).waitFor();
      assert.equal(await page.locator('textarea[name="notes"]').inputValue(), "Synthetic private note");
      assert.equal(await page.getByText("Foreign private note").count(), 0);
    } finally { await context.close(); }
  });
  test(`${locale} directory denies anonymous and foreign client access`, async () => {
    const anonymous = await pageFor(null);
    try {
      await anonymous.page.goto(`${origin}/${locale}/dashboard/clients`);
      await anonymous.page.waitForURL(`${origin}/${locale}/login`);
    } finally { await anonymous.context.close(); }
    const member = await pageFor("staff");
    try {
      const response = await member.page.goto(`${origin}/${locale}/dashboard/clients/${foreignId}`);
      assert.equal(response.status(), 404);
      assert.equal(await member.page.getByText("Foreign private note").count(), 0);
    } finally { await member.context.close(); }
  });
}

test("profile form rejects an invalid phone before any client write", async () => {
  const { context, page } = await pageFor("staff");
  try {
    await page.goto(`${origin}/en/dashboard/clients/${clientId}`);
    await page.locator('input[name="phone"]').fill("123");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "7 to 15 digits" }).waitFor();
    assert.equal(page.url(), `${origin}/en/dashboard/clients/${clientId}`);
  } finally { await context.close(); }
});

test("staff can submit a valid tenant-scoped profile update", async () => {
  const { context, page } = await pageFor("staff");
  try {
    await page.goto(`${origin}/en/dashboard/clients/${clientId}`);
    await page.locator('input[name="phone"]').fill("+1 555 010 5678");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Profile saved." }).waitFor();
  } finally { await context.close(); }
});

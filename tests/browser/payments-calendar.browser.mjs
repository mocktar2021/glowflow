import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const { chromium } = await import(process.env.GLOWFLOW_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.GLOWFLOW_PLAYWRIGHT_PATH).href : "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = path.join(root, "tests/browser/fixture");
const artifacts = path.join(root, "test-results/browser/payments-calendar");
let server, browser, origin;
let output = "";

before(async () => {
  await mkdir(artifacts, { recursive: true });
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  // The fixture never receives application or payment-provider credentials.
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/SUPABASE|STRIPE|GLOWFLOW_APP|VERCEL/.test(key)));
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"),
    "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: fixture, env: { ...env, NEXT_TELEMETRY_DISABLED: "1" },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", value => output += value);
  server.stderr.on("data", value => output += value);
  const deadline = Date.now() + 120000;
  while (true) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(10000) });
      if (response.ok) break;
    } catch { /* startup */ }
    if (Date.now() > deadline) throw new Error(`Fixture failed to start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  browser = await chromium.launch({
    headless: true, executablePath: process.env.GLOWFLOW_CHROMIUM_PATH || undefined,
  });
  await writeFile(path.join(artifacts, "runtime.json"), JSON.stringify({
    node: process.version, browser: browser.version(),
    playwrightOverride: Boolean(process.env.GLOWFLOW_PLAYWRIGHT_PATH),
    chromiumOverride: Boolean(process.env.GLOWFLOW_CHROMIUM_PATH),
  }, null, 2));
}, { timeout: 150000 });

after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) server.kill("SIGTERM");
  await writeFile(path.join(artifacts, "server.log"), output);
});

async function pageFor(t, identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (identity) await context.addCookies([{ name: "fixture-identity", value: identity, url: origin }]);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(90000);
  const errors = [], externalRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /hydrat|server rendered HTML/i.test(message.text()))
      errors.push(message.text());
  });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin !== origin) {
      externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  t.after(async () => {
    try {
      await page.screenshot({
        path: path.join(artifacts, `${t.name.replace(/[^a-z0-9-]/gi, "-")}.png`),
        fullPage: true,
      });
      assert.deepEqual(errors, [], "no runtime or hydration errors");
      assert.deepEqual(externalRequests, [], "fixture must not contact Stripe or another host");
    } finally { await context.close(); }
  });
  return page;
}

test("payment route denies staff and calendar route redirects anonymous visitors", async t => {
  const staff = await pageFor(t, "staff");
  await staff.goto(`${origin}/en/dashboard/payments`);
  await staff.waitForURL(`${origin}/en/dashboard`);
  assert.equal(await staff.getByRole("button", { name: "Record" }).count(), 0);

  const anonymous = await pageFor(t, null);
  await anonymous.goto(`${origin}/en/dashboard/calendar?date=2030-06-15`);
  await anonymous.waitForURL(`${origin}/en/login`);
  assert.equal(await anonymous.getByRole("button", { name: "Cancel" }).count(), 0);
});

test("owner sees a localized over-balance error without a success signal", async t => {
  const page = await pageFor(t, "payment-error");
  await page.goto(`${origin}/en/dashboard/payments`);
  const appointment = page.locator("article").filter({ hasText: "Synthetic checkout" });
  await appointment.locator('input[name="amount"]').fill("10.00");
  await appointment.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "exceeds the outstanding balance" }).waitFor();
  assert.equal(await page.getByRole("status").filter({ hasText: "Payment recorded." }).count(), 0);
});

test("owner records synthetic cash and external card, then cancels without a Stripe request", async t => {
  const page = await pageFor(t, "owner");
  await page.goto(`${origin}/en/dashboard/payments`);
  const appointment = page.locator("article").filter({ hasText: "Synthetic checkout" });
  await appointment.getByRole("heading", { name: "Synthetic checkout" }).waitFor();
  assert.match(await appointment.innerText(), /Outstanding:\s*\$40\.00/);

  await appointment.locator('input[name="amount"]').fill("12.50");
  await appointment.locator('select[name="payment_method"]').selectOption("cash");
  await appointment.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Payment recorded." }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("article")]
    .find(item => item.querySelector("h3")?.textContent === "Synthetic checkout")
    ?.querySelector('input[name="amount"]')?.getAttribute("max") === "27.50");

  await appointment.locator('input[name="amount"]').fill("27.50");
  await appointment.locator('select[name="payment_method"]').selectOption("external_card");
  await appointment.getByRole("button", { name: "Record", exact: true }).click();
  await appointment.locator("form").waitFor({ state: "detached" });
  assert.match(await appointment.innerText(), /Outstanding:\s*\$0\.00/);

  await page.goto(`${origin}/en/dashboard/calendar?date=2030-06-15&view=day`);
  await page.getByRole("heading", { name: "Calendar", exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Change saved." }).waitFor();
  await page.getByText("Canceled", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).count(), 0);

  await page.goto(`${origin}/en/dashboard/payments`);
  assert.equal(await page.getByRole("heading", { name: "Synthetic checkout" }).count(), 0,
    "canceled appointment is not offered for another payment");
});

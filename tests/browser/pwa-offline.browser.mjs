import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.GLOWFLOW_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.GLOWFLOW_PLAYWRIGHT_PATH).href
  : "playwright");
const worker = await readFile(new URL("../../public/sw.js", import.meta.url));
const privateMarker = "fictional-private-client-marker";
let server;
let browser;
let origin;
let bookingPosts = 0;
let networkDown = false;

before(async () => {
  server = createServer((request, response) => {
    // Playwright offline mode can still reach loopback on some Chromium builds.
    // Tear down that connection too, so the worker sees a real fetch failure.
    if (networkDown) {
      request.socket.destroy();
      return;
    }
    if (request.url === "/sw.js") {
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "service-worker-allowed": "/",
      });
      response.end(worker);
      return;
    }
    if (request.method === "POST") bookingPosts++;
    const content = request.url === "/en/dashboard/clients" ? privateMarker : `online ${request.url}`;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(`<!doctype html><html lang="en"><body><main>${content}</main></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.GLOWFLOW_CHROMIUM_PATH || undefined,
  });
}, { timeout: 30000 });

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

test("registered PWA worker recovers online without caching private pages or replaying offline bookings", async () => {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/fr/salons`);
    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      return registration.scope;
    });
    assert.equal(scope, `${origin}/`);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    const live = await page.goto(`${origin}/en/dashboard/clients`);
    assert.equal(live.status(), 200);
    assert.match(await page.locator("main").innerText(), new RegExp(privateMarker));
    assert.deepEqual(await page.evaluate(() => caches.keys()), []);

    networkDown = true;
    await context.setOffline(true);
    for (const [locale, expected] of [
      ["fr", "GlowFlow est hors ligne"],
      ["en", "GlowFlow is offline"],
      ["es", "GlowFlow está sin conexión"],
    ]) {
      const offline = await page.goto(`${origin}/${locale}/dashboard/clients`);
      assert.equal(offline.status(), 503);
      assert.equal(offline.fromServiceWorker(), true);
      assert.equal(offline.headers()["cache-control"], "no-store");
      assert.equal(await page.locator("html").getAttribute("lang"), locale);
      assert.equal(await page.locator("h1").innerText(), expected);
      assert.equal(await page.locator("main p").count(), 2);
      assert.equal(await page.locator("main a").count(), 1);
      assert.equal(await page.getByText(privateMarker).count(), 0);
    }

    // A failed offline booking request must not be queued or replayed on reconnect.
    networkDown = false;
    await context.setOffline(false);
    await page.goto(`${origin}/fr/salons`);
    networkDown = true;
    await context.setOffline(true);
    const failedOfflinePost = await page.evaluate(async () => {
      try {
        await fetch("/api/public-booking", { method: "POST", body: "fictional-booking" });
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(failedOfflinePost, true);
    assert.equal(bookingPosts, 0);

    networkDown = false;
    await context.setOffline(false);
    const recovered = await page.goto(`${origin}/fr/salons`);
    assert.equal(recovered.status(), 200);
    assert.equal(await page.locator("main").innerText(), "online /fr/salons");
    assert.deepEqual(await page.evaluate(() => caches.keys()), []);
    assert.equal(bookingPosts, 0);
  } finally {
    networkDown = false;
    await context.close();
  }
}, { timeout: 60000 });

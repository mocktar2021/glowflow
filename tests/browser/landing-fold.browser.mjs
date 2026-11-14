import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const { chromium } = await import(process.env.GLOWFLOW_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.GLOWFLOW_PLAYWRIGHT_PATH).href : "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
let server, browser, origin;
let output = "";

before(async () => {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/SUPABASE|STRIPE|GLOWFLOW_APP|VERCEL/.test(key)));
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"),
    "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root, env: { ...env, NEXT_TELEMETRY_DISABLED: "1" },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", value => output += value);
  server.stderr.on("data", value => output += value);
  const deadline = Date.now() + 120000;
  while (true) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      const response = await fetch(`${origin}/fr`, { signal: AbortSignal.timeout(10000) });
      if (response.ok) break;
    } catch { /* Still starting. */ }
    if (Date.now() > deadline) throw new Error(`Landing failed to start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.GLOWFLOW_CHROMIUM_PATH || undefined });
}, { timeout: 150000 });

after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) server.kill("SIGTERM");
});

test("FR, EN, and ES landing actions fit within the first desktop viewport", async () => {
  for (const locale of ["fr", "en", "es"]) {
    for (const [width, height] of [[1024, 768], [1280, 720], [1366, 768]]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
      try {
        const page = await context.newPage();
        const response = await page.goto(`${origin}/${locale}`);
        assert.equal(response.status(), 200);
        await page.evaluate(() => document.fonts.ready);
        for (const route of ["register", "salons"]) {
          const action = page.locator(`main section:first-child a[href="/${locale}/${route}"]`);
          const box = await action.boundingBox();
          assert.ok(box, `${locale} ${route} action is rendered`);
          assert.ok(box.y >= 0 && box.y + box.height <= height,
            `${locale} ${route} action ends at ${Math.round(box.y + box.height)}px in ${width}×${height}`);
        }
      } finally { await context.close(); }
    }
  }
}, { timeout: 120000 });

test("repeated GlowFlow wordmarks keep SVG clipping local to each instance", async () => {
  const page = await browser.newPage();
  try {
    const response = await page.goto(`${origin}/fr`);
    assert.equal(response.status(), 200);
    const wordmarks = await page.locator('svg[aria-label="GlowFlow"]').evaluateAll(logos => logos.map(logo => ({
      ids: [...logo.querySelectorAll("clipPath[id]")].map(clip => clip.id),
      references: [...logo.querySelectorAll("path[clip-path]")]
        .map(glyph => glyph.getAttribute("clip-path")),
    })));
    assert.ok(wordmarks.length >= 2, "landing renders the wordmark in the header and closing section");
    const allIds = wordmarks.flatMap(logo => logo.ids);
    assert.equal(allIds.length, wordmarks.length * 2);
    assert.equal(new Set(allIds).size, allIds.length, "clipPath IDs must be unique across wordmarks");
    for (const logo of wordmarks) {
      assert.deepEqual(logo.references, logo.ids.map(id => `url(#${id})`));
    }
  } finally { await page.close(); }
}, { timeout: 30000 });

test("FR, EN, and ES phone landing keeps navigation visible and respects reduced motion", async () => {
  for (const locale of ["fr", "en", "es"]) {
    for (const width of [360, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
      try {
        const page = await context.newPage();
        const response = await page.goto(`${origin}/${locale}`);
        assert.equal(response.status(), 200);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator("main video").count(), 0, `${locale} reduced motion renders posters, not video`);
        assert.equal(await page.locator("#hero-title").evaluate(element => getComputedStyle(element).animationName), "none");

        await page.evaluate(() => window.scrollTo(0, 650));
        await page.waitForFunction(() => window.scrollY >= 600);
        const header = page.locator("header");
        const box = await header.boundingBox();
        assert.ok(box && Math.abs(box.y) <= 1, `${locale} header stays at the viewport top at ${width}px`);
        assert.equal(await header.locator(`a[href="/${locale}"]`).first().isVisible(), true);
        assert.equal(await header.locator(`a[href="/${locale}/login"]`).isVisible(), true);
        const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(horizontalOverflow <= 1, `${locale} has no page-wide horizontal overflow at ${width}px`);
      } finally { await context.close(); }
    }
  }
}, { timeout: 120000 });

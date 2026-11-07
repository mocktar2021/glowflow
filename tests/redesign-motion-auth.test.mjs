import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

import { landingCopy } from "../lib/landing-copy.ts";

const root = new URL("../", import.meta.url);

test("motion previews use supplied local assets and respect reduced motion", async () => {
  const component = await readFile(new URL("components/glowflow/motion-preview.tsx", root), "utf8");
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.match(component, /IntersectionObserver/);
  assert.match(component, /preload="none"/);
  assert.match(component, /motionAllowed \? <video/);
  for (const file of [
    "glowflow-hero-loop-poster.jpg", "glowflow-hero-loop.webm", "glowflow-hero-loop.mp4", "glowflow-hero-loop-960.mp4",
    "glowflow-booking-flow-poster.jpg", "glowflow-booking-flow.webm", "glowflow-booking-flow.mp4",
  ]) {
    const asset = await stat(new URL(`public/motion/${file}`, root));
    assert.ok(asset.size > 0 && asset.size < 400_000, `${file} should be a bounded, nonempty asset`);
  }
  for (const locale of ["fr", "en", "es"]) {
    assert.match(landingCopy[locale].hero.motionNotice, /ficti|fictional/i);
    assert.match(landingCopy[locale].motion.notice, /ficti|fictional/i);
  }
});

test("auth pages link to localized home and active app code has no sparkle symbol", async () => {
  const shell = await readFile(new URL("components/glowflow/auth-shell.tsx", root), "utf8");
  const register = await readFile(new URL("app/[locale]/register/page.tsx", root), "utf8");
  assert.match(shell, /href=\{`\/\$\{locale\}`\}/);
  assert.match(shell, /<BrandLogo/);
  assert.match(register, /title=\{labels.title\} subtitle=\{labels.subtitle\} wide/);
  for (const directory of ["app", "components"]) {
    const files = await readdir(new URL(`${directory}/`, root), { recursive: true });
    for (const file of files.filter((path) => /\.(tsx|ts)$/.test(path))) {
      const content = await readFile(new URL(`${directory}/${file}`, root), "utf8");
      assert.doesNotMatch(content, /Sparkles|\u2728|\u2726/, `${directory}/${file}`);
    }
  }
});

test("stock photo and full wordmark replace the synthetic photo and isolated letter", async () => {
  const photo = await readFile(new URL("public/brand/pexels-nail-colors.webp", root));
  assert.equal(photo.subarray(0, 4).toString(), "RIFF");
  assert.equal(photo.subarray(8, 12).toString(), "WEBP");
  assert.ok(photo.length > 20_000 && photo.length < 200_000);
  const source = await readFile(new URL("docs/GLOW-58-stock-photo-wordmark.md", root), "utf8");
  assert.match(source, /pexels\.com\/photo\/finger-pointing-at-nail-color-palette-7755241/);
  assert.match(source, /pexels\.com\/license/);
  const logo = await readFile(new URL("components/glowflow/brand-logo.tsx", root), "utf8");
  assert.doesNotMatch(logo, /compact/);
  for (const locale of ["fr", "en", "es"]) assert.match(landingCopy[locale].hero.stockCaption, /Pexels/);
  for (const path of ["app/[locale]/page.tsx", "components/glowflow/auth-shell.tsx"]) {
    const content = await readFile(new URL(path, root), "utf8");
    assert.match(content, /pexels-nail-colors\.webp/);
    assert.doesNotMatch(content, /illustrative-manicure\.jpg|BrandLogo compact/);
  }
});

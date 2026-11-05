import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

import manifest from "../app/manifest.ts";

const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);

async function pngDimensions(name) {
  const png = await readFile(publicFile(name));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${name} is a PNG`);
  assert.equal(png.subarray(12, 16).toString(), "IHDR", `${name} has an IHDR chunk`);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

async function layoutMetadata(environment) {
  const source = await readFile(new URL("../app/[locale]/layout.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", "process", js)((name) => {
    if (name === "next/navigation") return { notFound() { throw new Error("not-found"); } };
    if (name === "@/components/glowflow/i18n-provider") return { GlowFlowIntlProvider: () => null };
    if (name === "@/components/glowflow/legal-footer") return { LegalFooter: () => null };
    if (name === "@/components/glowflow/pwa-registration") return { PwaRegistration: () => null };
    if (name === "@/lib/i18n") return { isLocale: () => true, messages: {} };
    if (name === "react/jsx-runtime" || name === "../globals.css") return {};
    throw new Error(`Unexpected layout dependency: ${name}`);
  }, loaded.exports, { env: environment });
  return loaded.exports.metadata;
}

test("favicon, Apple, app, and social PNG assets have their advertised dimensions", async () => {
  for (const [name, width, height] of [
    ["icon-32.png", 32, 32],
    ["apple-touch-icon.png", 180, 180],
    ["icon-192.png", 192, 192],
    ["icon-512.png", 512, 512],
    ["og-glowflow.png", 1200, 630],
  ]) assert.deepEqual(await pngDimensions(name), [width, height]);

  const ico = await readFile(publicFile("favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, index) => ico[6 + index * 16]).sort((a, b) => a - b);
  assert.deepEqual(sizes, [16, 32, 48]);
});

test("original vector artwork uses the GlowFlow palette without external image references", async () => {
  for (const name of ["favicon.svg", "og-glowflow.svg"]) {
    const source = await readFile(publicFile(name), "utf8");
    assert.match(source, /#0f172a/);
    assert.match(source, /#e7b779/);
    assert.doesNotMatch(source, /<image\b|<use\b|(?:href|src)\s*=\s*["']https?:/i);
  }
});

test("metadata and manifest advertise all icon and social previews", async () => {
  const production = await layoutMetadata({ VERCEL_ENV: "production", VERCEL_URL: "preview.vercel.app" });
  assert.equal(production.metadataBase.href, "https://glowflow.mocktar.com/");
  assert.deepEqual(production.icons.icon.map(({ url }) => url), ["/favicon.svg", "/icon-32.png"]);
  assert.equal(production.icons.shortcut, "/favicon.ico");
  assert.equal(production.icons.apple[0].url, "/apple-touch-icon.png");
  assert.equal(production.openGraph.images[0].url, "/og-glowflow.png");
  assert.equal(production.twitter.card, "summary_large_image");
  assert.equal((await layoutMetadata({ VERCEL_URL: "preview.vercel.app" })).metadataBase.href, "https://preview.vercel.app/");

  const webApp = manifest();
  assert.equal(webApp.start_url, "/fr/salons");
  assert.deepEqual(webApp.icons.map(({ src, sizes }) => [src, sizes]), [
    ["/icon-192.png", "192x192"],
    ["/icon-512.png", "512x512"],
  ]);
});

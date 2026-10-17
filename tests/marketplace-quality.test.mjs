import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const loadingPath = new URL("../app/[locale]/salons/(search)/loading.tsx", import.meta.url);
const locationPath = new URL("../app/[locale]/salons/locations/[country]/[[...city]]/page.tsx", import.meta.url);

function contrastRatio(foreground, background) {
  function luminance(hex) {
    const channels = hex.match(/../g).map((value) => Number.parseInt(value, 16) / 255);
    const [red, green, blue] = channels.map((value) => value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("search loading state announces the active language and respects reduced motion", async () => {
  const source = await readFile(loadingPath, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;

  for (const [locale, label] of [
    ["fr", "Chargement des salons"],
    ["en", "Loading salons"],
    ["es", "Cargando salones"],
    ["unknown", "Chargement des salons"],
  ]) {
    const loaded = { exports: {} };
    new Function("require", "exports", js)((name) => {
      if (name === "next-intl") return { useLocale: () => locale };
      if (name === "react/jsx-runtime") return jsxRuntime;
      throw new Error(`Unexpected loading-page dependency: ${name}`);
    }, loaded.exports);
    const html = renderToStaticMarkup(React.createElement(loaded.exports.default));
    assert.ok(html.includes(`aria-label="${label}"`));
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /motion-safe:animate-pulse/);
  }
});

const jsxRuntime = await import("react/jsx-runtime");

test("location eyebrow meets WCAG AA normal-text contrast on its light card", async () => {
  const source = await readFile(locationPath, "utf8");
  const eyebrow = source.match(/<p className="([^"]*)">\{location\.city \? labels\.city : labels\.country\}<\/p>/);
  assert.ok(eyebrow, "Expected the location eyebrow to declare a light-theme text color");
  const lightColor = eyebrow[1].match(/(?:^|\s)text-\[#([0-9a-f]{6})\]/);
  assert.ok(lightColor, "Expected a light-theme foreground color");
  assert.ok(contrastRatio(lightColor[1], "ffffff") >= 4.5);
});

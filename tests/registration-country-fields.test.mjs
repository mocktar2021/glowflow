import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { fallbackMarkets, marketName, marketPostalCodeLabel } from "../lib/markets.ts";

const require = createRequire(import.meta.url);

async function renderCountryFields(locale) {
  const source = await readFile(new URL("../components/glowflow/country-fields.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", js)((name) => {
    if (name === "@/components/glowflow/auth-shell") return { inputClass: "input" };
    if (name === "@/lib/markets") return { marketName, marketPostalCodeLabel };
    return require(name);
  }, loaded.exports);
  // Reverse alphabetical order guards against relying on the market's array position.
  return renderToStaticMarkup(createElement(loaded.exports.CountryFields, { locale, markets: [...fallbackMarkets].reverse() }));
}

test("registration asks for country before showing a time zone or postal field", async () => {
  for (const [locale, prompt] of [
    ["fr", "Choisir un pays"], ["en", "Choose a country"], ["es", "Elegir un país"],
  ]) {
    const html = await renderCountryFields(locale);
    assert.match(html, new RegExp(`<option value="" disabled="" selected="">${prompt}</option>`));
    assert.match(html, /name="country_code"[^>]*required=""/);
    assert.doesNotMatch(html, /name="time_zone"|name="postal_code"|Europe\/Madrid/);
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { legalCopy, supportEmail } from "../lib/legal-content.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

async function renderFooter(locale) {
  const source = await readFile(path.join(root, "components/glowflow/legal-footer.tsx"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", js)((name) => {
    if (name === "next/link") return function MockLink({ children, ...props }) { return createElement("a", props, children); };
    if (name === "@/lib/legal-content") return { legalCopy, supportEmail };
    return require(name);
  }, loaded.exports);
  return renderToStaticMarkup(createElement(loaded.exports.LegalFooter, { locale }));
}

test("publishes localized privacy, terms, support, and cancellation guidance", async () => {
  const content = await readFile(path.join(root, "lib/legal-content.ts"), "utf8");
  for (const locale of ["fr", "en", "es"]) assert.match(content, new RegExp(`\\b${locale}: \\{`));
  assert.match(content, /glowflow@mocktar\.com/);
  assert.match(content, /Supabase/);
  assert.match(content, /Vercel/);
  assert.match(content, /Stripe/);
  assert.match(content, /full card numbers/);
  assert.match(content, /cancellation, refund, and no-show policy/);
  assert.match(content, /Never send a password, secret key, or full card number/);
});

test("links every localized surface to product legal and support routes", async () => {
  const footer = await readFile(path.join(root, "components/glowflow/legal-footer.tsx"), "utf8");
  for (const route of ["privacy", "terms", "support"]) assert.match(footer, new RegExp(`locale\\}/${route}`));
  assert.match(footer, /mailto:\$\{supportEmail\}/);
});

test("footer links Mocktar Technologies to the requested language site", async () => {
  for (const [locale, target] of [
    ["fr", "https://mocktar.com/fr"],
    ["en", "https://mocktar.com"],
    ["es", "https://mocktar.com"],
  ]) {
    const html = await renderFooter(locale);
    const operatorLink = html.match(new RegExp(`<a href="${target}"[^>]*>Mocktar Technologies</a>`))?.[0];
    assert.ok(operatorLink);
    assert.match(operatorLink, /target="_blank"/);
    assert.match(operatorLink, /rel="noopener noreferrer"/);
    for (const route of ["privacy", "terms", "support"]) {
      assert.match(html, new RegExp(`href="/${locale}/${route}"`));
    }
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";

function moduleUrl(source) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
}
const copyUrl = moduleUrl(await readFile(new URL("../lib/sandbox-payment-copy.ts", import.meta.url), "utf8"));
const { sandboxPaymentCopy, isSandboxPaymentStatus } = await import(copyUrl);
const source = (await readFile(new URL("../components/glowflow/sandbox-payment-status.tsx", import.meta.url), "utf8"))
  .replace('import Link from "next/link";', 'const Link = "a";')
  .replaceAll('"react"', JSON.stringify(import.meta.resolve("react")))
  .replaceAll('"@/lib/sandbox-payment-copy"', JSON.stringify(copyUrl));
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  .replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const { SandboxPaymentStatusPanel } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("all locales render pending verification before any authoritative response", () => {
  for (const locale of ["fr", "en", "es"]) {
    const html = renderToStaticMarkup(React.createElement(SandboxPaymentStatusPanel, { locale, salonSlug: "test-salon", reservationId: "payment=success" }));
    const labels = sandboxPaymentCopy[locale];
    assert.ok(html.includes(labels.pending));
    assert.ok(html.includes(labels.notice));
    assert.ok(!html.includes(labels.paid));
    assert.match(html, /aria-live="polite"/);
    assert.match(html, new RegExp(`/${locale}/dashboard/payments`));
  }
});

test("payment states are an explicit allowlist with localized remediation", () => {
  for (const status of ["reserved", "pending", "paid", "expired", "failed", "reconciliation_required"]) {
    assert.equal(isSandboxPaymentStatus(status), true);
    for (const locale of ["fr", "en", "es"]) assert.ok(sandboxPaymentCopy[locale][status].length > 20);
  }
  for (const status of ["success", "confirmed", "canceled", "__proto__", null, {}]) assert.equal(isSandboxPaymentStatus(status), false);
});

test("switching language preserves sandbox mode and reservation query state", async () => {
  const require = createRequire(import.meta.url);
  const source = await readFile(new URL("../components/glowflow/language-switcher.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const pushed = [];
  const exports = {};
  const dependencies = (name) => {
    if (name === "react") return { ...React, useTransition: () => [false, (callback) => callback()] };
    if (name === "next/navigation") return { usePathname: () => "/fr/book/test-salon", useRouter: () => ({ push: (path) => pushed.push(path) }) };
    if (name.startsWith("@/components/") || name === "lucide-react") return new Proxy({}, { get: (_, key) => key });
    return require(name);
  };
  const browser = { location: { search: "?sandbox=1&sandboxReservation=abc", hash: "#details" }, localStorage: { setItem() {} } };
  new Function("require", "exports", "window", "document", "fetch", js)(dependencies, exports, browser, {}, async () => ({}));
  const tree = exports.LanguageSwitcher({ locale: "fr" });
  function find(node) {
    if (!node || typeof node !== "object") return null;
    if (node.props?.onValueChange) return node;
    return React.Children.toArray(node.props?.children).map(find).find(Boolean);
  }
  find(tree).props.onValueChange("en");
  assert.deepEqual(pushed, ["/en/book/test-salon?sandbox=1&sandboxReservation=abc#details"]);
});

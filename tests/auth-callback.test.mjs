import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const origin = "https://glowflow.mocktar.com";
const source = await readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

function callbackRoute() {
  const calls = [];
  const dependencies = {
    "next/server": { NextResponse: { redirect(destination) { return { location: destination.href }; } } },
    "@/lib/auth": { async ensureOwnerWorkspace() { calls.push("workspace"); return { error: null }; } },
    "@/lib/auth-copy": { authCopy: { fr: { notices: {} }, en: { notices: {} }, es: { notices: {} } } },
    "@/lib/i18n": { isLocale: (locale) => ["fr", "en", "es"].includes(locale) },
    "@/lib/supabase/server": { async createClient() { return { auth: { async exchangeCodeForSession() { calls.push("exchange"); return { error: null }; } } }; } },
  };
  const loaded = { exports: {} };
  new Function("require", "exports", js)((name) => dependencies[name], loaded.exports);
  return { GET: loaded.exports.GET, calls };
}

async function redirectFor(next) {
  const { GET, calls } = callbackRoute();
  const requestUrl = new URL("/auth/callback?code=fixture-code", origin);
  if (next !== null) requestUrl.searchParams.set("next", next);
  const response = await GET(new Request(requestUrl));
  assert.deepEqual(calls, ["exchange", "workspace"]);
  return response.location;
}

test("auth callback preserves supported same-origin destinations", async () => {
  for (const next of ["/fr/dashboard", "/en/update-password", "/es/dashboard?from=booking#details"]) {
    assert.equal(await redirectFor(next), new URL(next, origin).href);
  }
});

test("auth callback never redirects an exchanged session off-origin", async () => {
  for (const next of [
    null,
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "/\\attacker.example/steal",
    "/\t\\attacker.example/steal",
    "/%2F%2Fattacker.example/steal",
    "/%5Cattacker.example/steal",
    "javascript:alert(1)",
  ]) {
    assert.equal(await redirectFor(next), `${origin}/fr/dashboard`, `unsafe next: ${JSON.stringify(next)}`);
  }
});

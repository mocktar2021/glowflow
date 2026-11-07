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
  return { location: response.location, calls };
}

test("auth callback preserves supported same-origin destinations", async () => {
  for (const next of ["/fr/dashboard", "/en/update-password", "/es/dashboard?from=booking#details"]) {
    const result = await redirectFor(next);
    assert.equal(result.location, new URL(next, origin).href);
    assert.deepEqual(result.calls, ["exchange", "workspace"]);
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
    const result = await redirectFor(next);
    assert.equal(result.location, `${origin}/fr/dashboard`, `unsafe next: ${JSON.stringify(next)}`);
    assert.deepEqual(result.calls, ["exchange", "workspace"]);
  }
});

test("only the exact staff-join completion bypasses owner onboarding", async () => {
  for (const locale of ["fr", "en", "es"]) {
    const destination = `/${locale}/join/complete`;
    assert.deepEqual(await redirectFor(destination), {
      location: `${origin}${destination}`, calls: ["exchange"],
    });
  }
  for (const destination of [
    "/fr/join", "/fr/join/complete/extra", "/de/join/complete",
    "/fr/join/complete?token=secret", "/fr/join/complete#token=secret",
  ]) {
    const result = await redirectFor(destination);
    assert.deepEqual(result.calls, ["exchange", "workspace"], destination);
  }
});

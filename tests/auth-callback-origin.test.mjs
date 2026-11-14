import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

import { publicSiteOrigin } from "../lib/public-site-origin.ts";

const source = await readFile(new URL("../lib/auth-callback-origin.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)(
  name => {
    assert.equal(name, "@/lib/public-site-origin");
    return { publicSiteOrigin };
  }, loaded, loaded.exports,
);
const { authCallbackOrigin } = loaded.exports;

test("current QA Production and Preview callbacks stay unchanged before cutover", () => {
  assert.equal(authCallbackOrigin({ VERCEL_ENV: "production" }), "https://glowflow.mocktar.com");
  assert.equal(authCallbackOrigin({ VERCEL_ENV: "production", GLOWFLOW_APP_URL: "https://glowflow.mocktar.com" }), "https://glowflow.mocktar.com");
  assert.equal(authCallbackOrigin({ VERCEL_ENV: "production", GLOWFLOW_APP_URL: "https://glowflow.mocktar.com/" }), "https://glowflow.mocktar.com");
  for (const origin of ["https://glowflow.beauty", "https://evil.example", "http://glowflow.mocktar.com", "https://glowflow.mocktar.com/path"]) {
    assert.equal(authCallbackOrigin({ VERCEL_ENV: "production", GLOWFLOW_APP_URL: origin }), null, origin);
  }
  assert.equal(authCallbackOrigin({ VERCEL_ENV: "preview", GLOWFLOW_CANONICAL_ORIGIN: "https://glowflow.beauty", GLOWFLOW_APP_URL: "https://preview.vercel.app" }), "https://preview.vercel.app");
});

test("explicit Production canonical requires an explicit matching Auth callback origin", () => {
  const env = { VERCEL_ENV: "production", GLOWFLOW_CANONICAL_ORIGIN: "https://glowflow.beauty", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" };
  assert.equal(authCallbackOrigin({ ...env, GLOWFLOW_APP_URL: "https://glowflow.beauty" }), "https://glowflow.beauty");
  assert.equal(authCallbackOrigin({ ...env, GLOWFLOW_APP_URL: "https://glowflow.beauty/" }), "https://glowflow.beauty");
  assert.equal(authCallbackOrigin({ ...env, GLOWFLOW_APP_URL: "https://glowflow.mocktar.com" }), null);
  assert.equal(authCallbackOrigin(env), null);
  assert.equal(authCallbackOrigin({ ...env, GLOWFLOW_APP_URL: "https://glowflow.beauty", NEXT_PUBLIC_SUPABASE_URL: "https://rfwhqutkiztxkagbhevp.supabase.co" }), null);
  assert.equal(authCallbackOrigin({ VERCEL_ENV: "production", GLOWFLOW_CANONICAL_ORIGIN: "https://glowflow.mocktar.com", GLOWFLOW_APP_URL: "https://glowflow.mocktar.com" }), "https://glowflow.mocktar.com");
});

test("invalid explicit Production canonical never falls back to a matching QA App URL", () => {
  for (const canonical of ["", "not-a-url", "http://glowflow.mocktar.com", "https://glowflow.mocktar.com/path", "https://glowflow.mocktar.com?x=1", "https://glowflow.mocktar.com.evil.example"]) {
    assert.equal(authCallbackOrigin({ VERCEL_ENV: "production", GLOWFLOW_CANONICAL_ORIGIN: canonical, GLOWFLOW_APP_URL: "https://glowflow.mocktar.com" }), null, canonical);
  }
});

test("explicit Production canonical rejects malformed callback URLs", () => {
  const env = { VERCEL_ENV: "production", GLOWFLOW_CANONICAL_ORIGIN: "https://glowflow.beauty", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" };
  for (const configured of ["", "http://glowflow.beauty", "https://glowflow.beauty.evil.example", "https://glowflow.beauty:444", "https://glowflow.beauty/path", "https://glowflow.beauty?x=1", "https://glowflow.beauty#fragment", " https://glowflow.beauty", "https://user@glowflow.beauty"]) {
    assert.equal(authCallbackOrigin({ ...env, GLOWFLOW_APP_URL: configured }), null, configured);
  }
  assert.equal(authCallbackOrigin({ ...env, GLOWFLOW_CANONICAL_ORIGIN: "https://evil.example", GLOWFLOW_APP_URL: "https://evil.example" }), null);
});

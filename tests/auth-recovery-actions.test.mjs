import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

import { authCopy } from "../lib/auth-copy.ts";

const origin = "https://fixture.example.invalid";
const source = await readFile(new URL("../app/[locale]/auth-actions.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

function recoveryActions({ resetError = null, updateError = null } = {}) {
  const calls = [];
  const dependencies = {
    "next/navigation": { redirect(location) { throw Object.assign(new Error("redirect"), { location }); } },
    "@/lib/auth": { safeLocale: locale => ["fr", "en", "es"].includes(locale) ? locale : "fr" },
    "@/lib/auth-copy": { authCopy },
    "@/lib/supabase/server": {
      async createClient() {
        calls.push({ method: "createClient" });
        return { auth: {
          async resetPasswordForEmail(email, options) {
            calls.push({ method: "resetPasswordForEmail", email, options });
            return { error: resetError };
          },
          async updateUser(value) {
            calls.push({ method: "updateUser", value });
            return { error: updateError };
          },
        } };
      },
    },
  };
  const loaded = { exports: {} };
  new Function("require", "exports", "process", compiled)(
    name => {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected import: ${name}`);
      return dependencies[name];
    }, loaded.exports, { env: { GLOWFLOW_APP_URL: origin } },
  );
  return { actions: loaded.exports, calls };
}

async function expectRedirect(action, expected) {
  await assert.rejects(action, error => {
    assert.equal(error.location, expected);
    return true;
  });
}

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} reset uses a localized same-origin callback and generic result`, async () => {
    const email = "fixture@example.invalid";
    const form = new FormData();
    form.set("email", `  ${email}  `);
    const expected = `/${locale}/forgot-password?message=${encodeURIComponent(authCopy[locale].notices.resetSent)}`;

    for (const resetError of [null, new Error("synthetic provider detail must remain private")]) {
      const { actions, calls } = recoveryActions({ resetError });
      await expectRedirect(() => actions.requestPasswordReset(locale, form), expected);
      assert.deepEqual(calls, [
        { method: "createClient" },
        { method: "resetPasswordForEmail", email, options: {
          redirectTo: `${origin}/auth/callback?next=/${locale}/update-password`,
        } },
      ]);
      assert.ok(!expected.includes("synthetic provider detail"));
      assert.ok(!expected.includes(email));
    }
  });

  test(`${locale} short replacement password is rejected before provider access`, async () => {
    const { actions, calls } = recoveryActions();
    const form = new FormData();
    form.set("password", "short");
    await expectRedirect(
      () => actions.updatePassword(locale, form),
      `/${locale}/update-password?error=${encodeURIComponent(authCopy[locale].notices.passwordLength)}`,
    );
    assert.deepEqual(calls, []);
  });

  test(`${locale} replacement password succeeds or shows a safe localized failure`, async () => {
    const form = new FormData();
    form.set("password", "  synthetic-password-123  ");
    for (const updateError of [null, new Error("synthetic provider detail must remain private")]) {
      const { actions, calls } = recoveryActions({ updateError });
      const expected = updateError
        ? `/${locale}/update-password?error=${encodeURIComponent(authCopy[locale].notices.passwordFailed)}`
        : `/${locale}/login?message=${encodeURIComponent(authCopy[locale].notices.passwordUpdated)}`;
      await expectRedirect(() => actions.updatePassword(locale, form), expected);
      assert.deepEqual(calls, [
        { method: "createClient" },
        { method: "updateUser", value: { password: "  synthetic-password-123  " } },
      ]);
      assert.ok(!expected.includes("synthetic provider detail"));
      assert.ok(!expected.includes("synthetic-password-123"));
    }
  });
}

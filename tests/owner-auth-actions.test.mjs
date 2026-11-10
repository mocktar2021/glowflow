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

function ownerActions({ signInError = null, signUpError = null, session = null, workspaceError = null, callbackOrigin = origin } = {}) {
  const calls = [];
  const dependencies = {
    "next/navigation": { redirect(location) { throw Object.assign(new Error("redirect"), { location }); } },
    "@/lib/auth": {
      safeLocale: locale => ["fr", "en", "es"].includes(locale) ? locale : "fr",
      async ensureOwnerWorkspace() {
        calls.push({ method: "ensureOwnerWorkspace" });
        return { error: workspaceError };
      },
    },
    "@/lib/auth-copy": { authCopy },
    "@/lib/auth-callback-origin": { authCallbackOrigin: () => callbackOrigin },
    "@/lib/supabase/server": {
      async createClient() {
        calls.push({ method: "createClient" });
        return { auth: {
          async signInWithPassword(value) {
            calls.push({ method: "signInWithPassword", value });
            return { error: signInError };
          },
          async signUp(value) {
            calls.push({ method: "signUp", value });
            return { data: { session }, error: signUpError };
          },
          async signOut() {
            calls.push({ method: "signOut" });
            return { error: null };
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

function ownerForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    full_name: "  Fixture Owner  ", salon_name: "  Salon Étoile & Co  ",
    email: "  owner@example.invalid  ", password: "  synthetic-password-123  ",
    country_code: "  fr  ", time_zone: "  Europe/Paris  ",
    address_line1: "  12 Example Street  ", city: "  Paris  ",
    postal_code: "  75001  ", administrative_area: "  Île-de-France  ",
  })) form.set(key, value);
  return form;
}

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} owner signup refuses an unavailable callback before Supabase access`, async () => {
    const { actions, calls } = ownerActions({ callbackOrigin: null });
    await expectRedirect(() => actions.signUp(locale, ownerForm()),
      `/${locale}/register?error=${encodeURIComponent(authCopy[locale].notices.signupFailed)}`);
    assert.deepEqual(calls, []);
  });

  test(`${locale} owner signup rejects incomplete fields before Supabase access`, async () => {
    const { actions, calls } = ownerActions();
    const form = ownerForm();
    form.set("password", "short");
    await expectRedirect(() => actions.signUp(locale, form),
      `/${locale}/register?error=${encodeURIComponent(authCopy[locale].notices.completeFields)}`);
    assert.deepEqual(calls, []);
  });

  test(`${locale} owner signup sends trimmed metadata and localized configured-origin callback`, async () => {
    const { actions, calls } = ownerActions();
    await expectRedirect(() => actions.signUp(locale, ownerForm()),
      `/${locale}/login?message=${encodeURIComponent(authCopy[locale].notices.checkEmail)}`);
    assert.deepEqual(calls, [
      { method: "createClient" },
      { method: "signUp", value: {
        email: "owner@example.invalid", password: "synthetic-password-123",
        options: { emailRedirectTo: `${origin}/auth/callback?next=/${locale}/dashboard`, data: {
          full_name: "Fixture Owner", salon_name: "Salon Étoile & Co", salon_slug: "salon-etoile-co",
          locale, country_code: "FR", time_zone: "Europe/Paris",
          address_line1: "12 Example Street", city: "Paris", postal_code: "75001",
          administrative_area: "Île-de-France",
        } },
      } },
    ]);
  });

  test(`${locale} signup keeps provider failures generic and only opens a workspace with a session`, async () => {
    const providerError = new Error("synthetic private provider detail");
    const failed = ownerActions({ signUpError: providerError });
    const failedRedirect = `/${locale}/register?error=${encodeURIComponent(authCopy[locale].notices.signupFailed)}`;
    await expectRedirect(() => failed.actions.signUp(locale, ownerForm()), failedRedirect);
    assert.deepEqual(failed.calls.map(call => call.method), ["createClient", "signUp"]);
    assert.ok(!failedRedirect.includes(providerError.message));

    const signedIn = ownerActions({ session: { access_token: "synthetic-not-logged" } });
    await expectRedirect(() => signedIn.actions.signUp(locale, ownerForm()), `/${locale}/dashboard`);
    assert.deepEqual(signedIn.calls.map(call => call.method), ["createClient", "signUp", "ensureOwnerWorkspace"]);

    const blocked = ownerActions({ session: {}, workspaceError: "synthetic private database detail" });
    const blockedRedirect = `/${locale}/login?message=${encodeURIComponent(authCopy[locale].notices.checkEmail)}`;
    await expectRedirect(() => blocked.actions.signUp(locale, ownerForm()), blockedRedirect);
    assert.deepEqual(blocked.calls.map(call => call.method), ["createClient", "signUp", "ensureOwnerWorkspace"]);
    assert.ok(!blockedRedirect.includes("database detail"));
  });

  test(`${locale} sign-in separates credential and workspace failures from success`, async () => {
    const form = new FormData();
    form.set("email", "  owner@example.invalid  ");
    form.set("password", "  synthetic-password-123  ");
    const credentialError = new Error("synthetic private credential detail");
    const invalid = ownerActions({ signInError: credentialError });
    const invalidRedirect = `/${locale}/login?error=${encodeURIComponent(authCopy[locale].notices.invalidCredentials)}`;
    await expectRedirect(() => invalid.actions.signIn(locale, form), invalidRedirect);
    assert.deepEqual(invalid.calls.map(call => call.method), ["createClient", "signInWithPassword"]);
    assert.deepEqual(invalid.calls[1].value, { email: "owner@example.invalid", password: "synthetic-password-123" });
    assert.ok(!invalidRedirect.includes(credentialError.message));

    const blocked = ownerActions({ workspaceError: "synthetic private database detail" });
    const blockedRedirect = `/${locale}/login?error=${encodeURIComponent(authCopy[locale].notices.workspaceNotReady)}`;
    await expectRedirect(() => blocked.actions.signIn(locale, form), blockedRedirect);
    assert.deepEqual(blocked.calls.map(call => call.method), ["createClient", "signInWithPassword", "ensureOwnerWorkspace"]);
    assert.ok(!blockedRedirect.includes("database detail"));

    const allowed = ownerActions();
    await expectRedirect(() => allowed.actions.signIn(locale, form), `/${locale}/dashboard`);
    assert.deepEqual(allowed.calls.map(call => call.method), ["createClient", "signInWithPassword", "ensureOwnerWorkspace"]);
  });

  test(`${locale} sign-out uses only the mocked Auth client and returns to localized login`, async () => {
    const { actions, calls } = ownerActions();
    await expectRedirect(() => actions.signOut(locale), `/${locale}/login`);
    assert.deepEqual(calls.map(call => call.method), ["createClient", "signOut"]);
  });
}

test("unsupported route locale falls back to French for owner signup and sign-in", async () => {
  const signup = ownerActions();
  await expectRedirect(() => signup.actions.signUp("de", ownerForm()),
    `/fr/login?message=${encodeURIComponent(authCopy.fr.notices.checkEmail)}`);
  const sent = signup.calls.find(call => call.method === "signUp").value;
  assert.equal(sent.options.data.locale, "fr");
  assert.equal(sent.options.emailRedirectTo, `${origin}/auth/callback?next=/fr/dashboard`);

  const signin = ownerActions();
  const form = new FormData();
  form.set("email", "owner@example.invalid");
  form.set("password", "synthetic-password-123");
  await expectRedirect(() => signin.actions.signIn("de", form), "/fr/dashboard");
  assert.deepEqual(signin.calls.map(call => call.method), ["createClient", "signInWithPassword", "ensureOwnerWorkspace"]);
});

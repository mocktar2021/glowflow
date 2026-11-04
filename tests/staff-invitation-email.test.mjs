import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/staff-invitation-email.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", js)(name => {
  if (name === "server-only") return {};
  if (name === "@/lib/staff-invitations") return {
    validStaffInvitationToken: token => /^[A-Za-z0-9_-]{43}$/.test(token),
    staffJoinLanguageHref: (locale, token) => `/${locale}/join#token=${token}`,
  };
  throw new Error(`unexpected import: ${name}`);
}, loaded, loaded.exports);

test("invitation email has accessible FR/EN/ES content and fragment-only links", () => {
  const token = "A".repeat(43);
  const message = loaded.exports.renderStaffInvitationEmail(token);
  assert.match(message.subject, /GlowFlow/);
  assert.match(message.html, /<html lang="fr" dir="ltr">/);
  assert.match(message.html, /<title>GlowFlow/);
  for (const locale of ["fr", "en", "es"]) {
    assert.match(message.html, new RegExp(`<section lang="${locale}" dir="ltr"`));
    const link = new URL(`https://glowflow.mocktar.com/${locale}/join#token=${token}`);
    assert.ok(message.html.includes(`href="${link.href}"`));
    assert.ok(message.text.includes(link.href));
    assert.equal(link.search, "");
    assert.equal(link.hash, `#token=${token}`);
  }
  assert.ok(!message.html.includes("—"));
  assert.ok(!message.text.includes("—"));
  assert.ok(!message.text.includes("example.invalid"));
});

test("malformed tokens never enter an email", () => {
  assert.throws(() => loaded.exports.renderStaffInvitationEmail("bad"), /Invalid invitation token/);
});

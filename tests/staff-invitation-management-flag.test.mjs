import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/staff-invitations.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function enabled(flags) {
  const loaded = { exports: {} };
  new Function("module", "exports", "process", js)(loaded, loaded.exports, { env: flags });
  return loaded.exports.staffInvitationManagementEnabled();
}

test("owner invitation controls require recipient, issuance and delivery gates together", () => {
  const all = {
    GLOWFLOW_STAFF_INVITES_ENABLED: "true",
    GLOWFLOW_STAFF_INVITE_ISSUANCE_ENABLED: "true",
    GLOWFLOW_STAFF_INVITE_DELIVERY_ENABLED: "true",
  };
  assert.equal(enabled({}), false);
  for (const name of Object.keys(all)) {
    assert.equal(enabled({ ...all, [name]: "false" }), false, `${name} must stay on`);
  }
  assert.equal(enabled(all), true);
});

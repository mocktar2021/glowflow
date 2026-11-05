import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(import.meta.url)("typescript");
const deliveryModule = /(?:^|\/)staff-invitation-(?:worker|runner|sender|resend)(?:\.[cm]?[jt]sx?)?$/;
const deliveryCall = new Set([
  "runStaffInvitationWorkerOnce",
  "runNextStaffInvitationDelivery",
  "processNextStaffInvitationDelivery",
  "createResendStaffInvitationTransport",
]);

async function appSources(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await appSources(file));
    else if (/\.(?:[jt]sx?|[cm]js)$/.test(entry.name)) {
      result.push({ file, source: await readFile(file, "utf8") });
    }
  }
  return result;
}

function sourceActivatesDelivery(source) {
  const file = ts.createSourceFile("entry.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let activates = false;
  function visit(node) {
    if (activates) return;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        && deliveryModule.test(node.moduleSpecifier.text)) activates = true;
    if (ts.isCallExpression(node)) {
      const called = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;
      if (called && deliveryCall.has(called)) activates = true;
      if ((called === "require" || node.expression.kind === ts.SyntaxKind.ImportKeyword)
          && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])
          && deliveryModule.test(node.arguments[0].text)) activates = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return activates;
}

function workflowActivatesDelivery(source) {
  const commands = [];
  let blockIndent = -1;
  for (const line of source.split(/\r?\n/)) {
    const indent = line.match(/^\s*/)[0].length;
    if (blockIndent >= 0 && line.trim() && indent <= blockIndent) blockIndent = -1;
    const run = line.match(/^(\s*)(?:-\s*)?run:\s*(.*)$/);
    if (run) {
      blockIndent = /^[|>]/.test(run[2]) ? run[1].length : -1;
      if (blockIndent < 0) commands.push(run[2]);
    } else if (blockIndent >= 0 && indent > blockIndent && !line.trim().startsWith("#")) {
      commands.push(line.trim());
    }
  }
  return /(?:runStaffInvitationWorkerOnce|runNextStaffInvitationDelivery|processNextStaffInvitationDelivery|createResendStaffInvitationTransport|staff-invitation-(?:worker|runner|sender|resend))/.test(commands.join("\n"));
}

test("activation detectors ignore comments and documentation but catch executable wiring", () => {
  assert.equal(sourceActivatesDelivery(`// import "@/lib/staff-invitation-worker";\nconst note = "runStaffInvitationWorkerOnce";`), false);
  assert.equal(sourceActivatesDelivery(`import { runStaffInvitationWorkerOnce } from "@/lib/staff-invitation-worker";\nrunStaffInvitationWorkerOnce(alert);`), true);
  assert.equal(sourceActivatesDelivery(`await import("../lib/staff-invitation-runner");`), true);
  assert.equal(workflowActivatesDelivery(`name: Invitation notes\n# run: node ops/staff-invitation-worker.mjs\nsteps:\n  - run: echo safe`), false);
  assert.equal(workflowActivatesDelivery(`steps:\n  - run: |\n      node ops/staff-invitation-worker.mjs`), true);
});

test("new invitation delivery code is not wired to an application route or enabled by default", async () => {
  const example = await readFile(path.join(root, ".env.example"), "utf8");
  for (const name of [
    "GLOWFLOW_STAFF_INVITES_ENABLED",
    "GLOWFLOW_STAFF_INVITE_ISSUANCE_ENABLED",
    "GLOWFLOW_STAFF_INVITE_DELIVERY_ENABLED",
  ]) {
    assert.match(example, new RegExp(`^${name}=false$`, "m"));
  }
  for (const folder of ["app", "ops"]) {
    for (const { file, source } of await appSources(path.join(root, folder))) {
      assert.equal(sourceActivatesDelivery(source), false, `${path.relative(root, file)} activates invitation delivery`);
    }
  }
  for (const entry of await readdir(path.join(root, ".github/workflows"))) {
    if (!/\.ya?ml$/.test(entry)) continue;
    const source = await readFile(path.join(root, ".github/workflows", entry), "utf8");
    assert.equal(workflowActivatesDelivery(source), false, `${entry} activates invitation delivery`);
  }
});

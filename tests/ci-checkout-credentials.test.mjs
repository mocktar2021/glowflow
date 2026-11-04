import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const workflows = ["ci.yml", "browser.yml", "security.yml"];

test("pull request workflows do not persist checkout credentials", async () => {
  for (const workflowName of workflows) {
    const workflow = await readFile(new URL(`.github/workflows/${workflowName}`, root), "utf8");
    assert.match(workflow, /permissions:\s*\n\s*contents: read\b/, `${workflowName} needs read-only permissions`);
    assert.match(
      workflow,
      /uses: actions\/checkout@[a-f\d]{40}[^\n]*\n\s*with:\s*\n\s*persist-credentials: false\b/,
      `${workflowName} must pin checkout and discard its credential before package scripts run`,
    );
  }
});

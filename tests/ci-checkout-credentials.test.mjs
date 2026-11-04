import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import yaml from "js-yaml";

const root = new URL("../", import.meta.url);
const workflows = ["ci.yml", "browser.yml", "security.yml"];

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseWorkflow(source, name) {
  const workflow = yaml.load(source, { filename: name });
  assert.ok(object(workflow), `${name} must be a YAML mapping`);
  return workflow;
}

function assertReadOnlyCheckout(workflow, name) {
  assert.deepEqual(workflow.permissions, { contents: "read" },
    `${name} must grant only repository read permission`);
  assert.ok(object(workflow.jobs), `${name} must define jobs`);
  const jobs = Object.values(workflow.jobs);
  assert.ok(jobs.length > 0, `${name} must define at least one job`);
  const checkouts = [];
  for (const job of jobs) {
    assert.ok(object(job), `${name} job must be a mapping`);
    assert.equal(job.permissions, undefined, `${name} job must not override read-only permissions`);
    assert.ok(Array.isArray(job.steps), `${name} job must define steps`);
    checkouts.push(...job.steps.filter(step => typeof step?.uses === "string"
      && step.uses.startsWith("actions/checkout@")));
  }
  assert.ok(checkouts.length > 0, `${name} must check out source`);
  for (const step of checkouts) {
    assert.match(step.uses, /^actions\/checkout@[a-f\d]{40}$/,
      `${name} must pin checkout to a full commit SHA`);
    assert.equal(step.with?.["persist-credentials"], false,
      `${name} must discard checkout credentials before package scripts run`);
  }
}

function assertPrSecretBoundary(workflow, name) {
  assert.ok(object(workflow.on), `${name} must declare events as a YAML mapping`);
  assert.ok(Object.hasOwn(workflow.on, "pull_request"), `${name} needs ordinary pull_request checks`);
  for (const event of ["pull_request_target", "workflow_run"]) {
    assert.ok(!Object.hasOwn(workflow.on, event), `${name} must not use privileged ${event}`);
  }
  function inspect(value) {
    if (Array.isArray(value)) {
      for (const item of value) inspect(item);
    } else if (object(value)) {
      for (const [key, item] of Object.entries(value)) {
        assert.ok(key !== "secrets" && key !== "environment",
          `${name} must not request secrets or a deployment environment`);
        inspect(item);
      }
    } else if (typeof value === "string") {
      // GitHub expressions can contain a quoted literal "}}". Scan the whole
      // parsed YAML scalar so that delimiter-like text cannot hide a reference.
      if (value.includes("${{")) {
        assert.doesNotMatch(value, /\b(?:secrets|vars)\b/i,
          `${name} must not inject repository secrets or variables into PR checks`);
      }
    }
  }
  inspect(workflow);
}

test("pull request workflows keep checkout and permissions read-only", async () => {
  for (const name of workflows) {
    const source = await readFile(new URL(`.github/workflows/${name}`, root), "utf8");
    assertReadOnlyCheckout(parseWorkflow(source, name), name);
  }
});

test("pull request workflows use no privileged trigger, secrets, or deployment environment", async () => {
  for (const name of workflows) {
    const source = await readFile(new URL(`.github/workflows/${name}`, root), "utf8");
    assertPrSecretBoundary(parseWorkflow(source, name), name);
  }
});

test("workflow guard rejects YAML bypasses but ignores comments", () => {
  const safe = "on:\n  pull_request:\njobs:\n  check:\n    steps: []\n";
  assert.doesNotThrow(() => assertPrSecretBoundary(parseWorkflow(safe, "safe"), "safe"));
  assert.doesNotThrow(() => assertPrSecretBoundary(parseWorkflow(safe + "# ${{ secrets.NOT_USED }}\n", "comment"), "comment"));
  for (const [name, source] of [
    ["inline privileged event", "on: { pull_request: {}, pull_request_target: {} }\njobs: { check: { steps: [] } }\n"],
    ["decoy job key", "on: [pull_request_target]\njobs:\n  fake:\n    pull_request: {}\n"],
    ["quoted environment", "on: { pull_request: {} }\njobs: { check: { \"environment\": production } }\n"],
    ["inherited secrets", "on: { pull_request: {} }\njobs: { check: { secrets: inherit } }\n"],
    ["bracket secret expression", "on: { pull_request: {} }\njobs: { check: { env: { TOKEN: \"${{ secrets['TOKEN'] }}\" } } }\n"],
    ["nested boolean secret expression", "on: { pull_request: {} }\njobs: { check: { env: { TOKEN: \"${{ github.event_name == 'pull_request' && secrets['PROD_TOKEN'] }}\" } } }\n"],
    ["formatted secret expression", "on: { pull_request: {} }\njobs: { check: { env: { TOKEN: \"${{ format('{0}', secrets.PROD_TOKEN) }}\" } } }\n"],
    ["quoted delimiter secret expression", "on: { pull_request: {} }\njobs: { check: { env: { TOKEN: \"${{ format('}}', secrets.PROD_TOKEN) }}\" } } }\n"],
  ]) {
    assert.throws(() => assertPrSecretBoundary(parseWorkflow(source, name), name),
      undefined, `${name} must fail the guard`);
  }
});

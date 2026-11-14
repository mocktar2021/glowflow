import assert from "node:assert/strict";
import test from "node:test";
import { assessPaidLaunchEvidence } from "../ops/paid-launch-evidence.mjs";

const requiredGates = [
  "legalCountryReview", "salonPolicyPublication", "supportAndAlerts",
  "historicalDatabaseAndStorageRestore", "migrationRecovery", "securityAndRls",
  "authPasswordProtection", "publicLocalesAndDomain", "signedInJourney",
  "liveChargeRefundAndWebhooks", "taxReceiptsAndReconciliation",
  "testFixtureRetirement", "rollbackAndIncidentCoverage",
];
const observedAt = "2026-11-14T16:00:00Z";
const releaseSha = "a".repeat(40);
const passed = () => ({ status: "passed", evidenceRef: "controlled:reviewed-evidence",
  checkedAtUtc: observedAt, verifier: "named release verifier" });

function record() {
  return {
    releaseType: "public-paid",
    asOfUtc: "2026-11-14T17:00:00Z",
    github: { repository: "mocktar2021/glowflow", branch: "master", sha: releaseSha,
      checks: Object.fromEntries(["ci", "databaseSecurity", "browser"].map(name => [name, {
        headSha: releaseSha, status: "passed", evidenceRef: `controlled:${name}-run`,
        checkedAtUtc: observedAt,
      }])) },
    vercel: { teamId: "team_ExampleProduction", projectId: "prj_ExampleProduction",
      deploymentId: "dpl_ExampleProduction", target: "production", state: "READY",
      gitSha: releaseSha, alias: "glowflow.beauty", evidenceRef: "controlled:production-alias",
      checkedAtUtc: observedAt },
    supabase: { organizationId: "abcdefghijklmnopqrst", projectRef: "zyxwvutsrqponmlkjihg",
      migrationLedgerSha256: "b".repeat(64), schemaSha256: "c".repeat(64),
      evidenceRef: "controlled:production-database", checkedAtUtc: observedAt },
    includedMigrations: [],
    gates: Object.fromEntries(requiredGates.map(name => [name, passed()])),
  };
}

test("a fully recorded paid-launch packet reaches owner review, not automatic go", () => {
  assert.deepEqual(assessPaidLaunchEvidence(record()), {
    result: "structurally-complete-for-owner-review", blockers: [],
  });
});

test("QA identities and stale exact-commit evidence cannot masquerade as production", () => {
  for (const change of [
    x => { x.vercel.projectId = "prj_YZ96jIX5QEOOI70zUlbHSaIqQbsu"; },
    x => { x.vercel.alias = "glowflow.mocktar.com"; },
    x => { x.vercel.gitSha = "b".repeat(40); },
    x => { x.supabase.projectRef = "rfwhqutkiztxkagbhevp"; },
    x => { x.github.checks.browser.headSha = "b".repeat(40); },
    x => { x.github.checks.ci.status = "pending"; },
  ]) {
    const candidate = record(); change(candidate);
    const result = assessPaidLaunchEvidence(candidate);
    assert.equal(result.result, "blocked");
    assert.ok(result.blockers.length > 0);
  }
});

test("a paid release cannot omit payment, recovery, legal or Auth protection evidence", () => {
  for (const gate of ["liveChargeRefundAndWebhooks", "historicalDatabaseAndStorageRestore",
    "legalCountryReview", "authPasswordProtection"]) {
    const candidate = record();
    candidate.gates[gate] = { ...passed(), status: "pending" };
    assert.ok(assessPaidLaunchEvidence(candidate).blockers.includes(gate));
  }
  const candidate = record();
  delete candidate.gates.taxReceiptsAndReconciliation;
  assert.ok(assessPaidLaunchEvidence(candidate).blockers.includes("required gate set"));
});

test("migration recovery is only not applicable with no included SQL and written approval", () => {
  const candidate = record();
  candidate.gates.migrationRecovery = { status: "not-applicable", reason: "No SQL in release",
    approvedBy: "named product owner", checkedAtUtc: observedAt };
  assert.equal(assessPaidLaunchEvidence(candidate).result, "structurally-complete-for-owner-review");
  candidate.includedMigrations = ["20261114160000_example.sql"];
  assert.ok(assessPaidLaunchEvidence(candidate).blockers.includes("migrationRecovery"));
});

test("future checks and unexpected fields block a release packet", () => {
  const candidate = record();
  candidate.gates.securityAndRls.checkedAtUtc = "2026-11-15T00:00:00Z";
  assert.ok(assessPaidLaunchEvidence(candidate).blockers.includes("securityAndRls"));
  candidate.gates.securityAndRls = { ...passed(), customerEmail: "private@example.invalid" };
  assert.ok(assessPaidLaunchEvidence(candidate).blockers.includes("securityAndRls"));
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This checks the structure of a release record, not the truth of linked evidence.
// It never contacts GitHub, Vercel, Supabase, Stripe, or a customer system.
const qaVercelProject = "prj_YZ96jIX5QEOOI70zUlbHSaIqQbsu";
const qaSupabaseProject = "rfwhqutkiztxkagbhevp";
const requiredGates = [
  "legalCountryReview", "salonPolicyPublication", "supportAndAlerts",
  "historicalDatabaseAndStorageRestore", "migrationRecovery", "securityAndRls",
  "authPasswordProtection",
  "publicLocalesAndDomain", "signedInJourney", "liveChargeRefundAndWebhooks",
  "taxReceiptsAndReconciliation", "testFixtureRetirement", "rollbackAndIncidentCoverage",
];
const sha = /^[a-f0-9]{40}$/;
const fingerprint = /^[a-f0-9]{64}$/;
const timestamp = value => typeof value === "string"
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z");
const nonempty = value => typeof value === "string"
  && value.trim() === value && value.length >= 3 && !/^(pending|tbd|n\/a)$/i.test(value);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => object(value)
  && Object.keys(value).sort().join("|") === keys.slice().sort().join("|");

function recordedPass(value, asOf) {
  return exactKeys(value, ["status", "evidenceRef", "checkedAtUtc", "verifier"])
    && value.status === "passed" && nonempty(value.evidenceRef)
    && nonempty(value.verifier) && timestamp(value.checkedAtUtc)
    && Date.parse(value.checkedAtUtc) <= asOf;
}

export function assessPaidLaunchEvidence(record) {
  if (!exactKeys(record, ["releaseType", "asOfUtc", "github", "vercel",
    "supabase", "includedMigrations", "gates"])) {
    return { result: "blocked", blockers: ["record shape"] };
  }
  const blockers = [];
  const asOf = timestamp(record.asOfUtc) ? Date.parse(record.asOfUtc) : NaN;
  if (record.releaseType !== "public-paid" || !Number.isFinite(asOf)) blockers.push("release scope and time");

  const git = record.github;
  if (!exactKeys(git, ["repository", "branch", "sha", "checks"])
    || git.repository !== "mocktar2021/glowflow" || git.branch !== "master"
    || !sha.test(git.sha) || !exactKeys(git.checks, ["ci", "databaseSecurity", "browser"])) {
    blockers.push("GitHub identity");
  } else {
    for (const [name, check] of Object.entries(git.checks)) {
      if (!exactKeys(check, ["headSha", "status", "evidenceRef", "checkedAtUtc"])
        || check.headSha !== git.sha || check.status !== "passed"
        || !nonempty(check.evidenceRef) || !timestamp(check.checkedAtUtc)
        || Date.parse(check.checkedAtUtc) > asOf) blockers.push(`GitHub ${name}`);
    }
  }

  const vercel = record.vercel;
  if (!exactKeys(vercel, ["teamId", "projectId", "deploymentId", "target",
    "state", "gitSha", "alias", "evidenceRef", "checkedAtUtc"])
    || !/^team_[A-Za-z0-9]+$/.test(vercel.teamId)
    || !/^prj_[A-Za-z0-9]+$/.test(vercel.projectId)
    || vercel.projectId === qaVercelProject
    || !/^dpl_[A-Za-z0-9]+$/.test(vercel.deploymentId)
    || vercel.target !== "production" || vercel.state !== "READY"
    || vercel.gitSha !== git?.sha || vercel.alias !== "glowflow.beauty"
    || !nonempty(vercel.evidenceRef) || !timestamp(vercel.checkedAtUtc)
    || Date.parse(vercel.checkedAtUtc) > asOf) blockers.push("separate beauty deployment");

  const supabase = record.supabase;
  if (!exactKeys(supabase, ["organizationId", "projectRef", "migrationLedgerSha256",
    "schemaSha256", "evidenceRef", "checkedAtUtc"])
    || !/^[a-z0-9]{20}$/.test(supabase.organizationId)
    || !/^[a-z0-9]{20}$/.test(supabase.projectRef)
    || supabase.projectRef === qaSupabaseProject
    || !fingerprint.test(supabase.migrationLedgerSha256)
    || !fingerprint.test(supabase.schemaSha256)
    || !nonempty(supabase.evidenceRef) || !timestamp(supabase.checkedAtUtc)
    || Date.parse(supabase.checkedAtUtc) > asOf) blockers.push("separate beauty database");

  if (!Array.isArray(record.includedMigrations)
    || record.includedMigrations.some(value => typeof value !== "string"
      || !/^\d{14}_[a-z0-9_]+\.sql$/.test(value))
    || new Set(record.includedMigrations).size !== record.includedMigrations.length) {
    blockers.push("migration list");
  }

  if (!exactKeys(record.gates, requiredGates)) {
    blockers.push("required gate set");
  } else {
    for (const gate of requiredGates) {
      const value = record.gates[gate];
      if (gate === "migrationRecovery" && Array.isArray(record.includedMigrations)
        && record.includedMigrations.length === 0
        && exactKeys(value, ["status", "reason", "approvedBy", "checkedAtUtc"])
        && value.status === "not-applicable" && nonempty(value.reason)
        && nonempty(value.approvedBy) && timestamp(value.checkedAtUtc)
        && Date.parse(value.checkedAtUtc) <= asOf) continue;
      if (!recordedPass(value, asOf)) blockers.push(gate);
    }
  }

  return {
    result: blockers.length ? "blocked" : "structurally-complete-for-owner-review",
    blockers,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("missing record");
    const assessment = assessPaidLaunchEvidence(JSON.parse(readFileSync(process.argv[2], "utf8")));
    console.log(JSON.stringify(assessment));
    if (assessment.result === "blocked") process.exitCode = 1;
  } catch {
    console.error("GLOW-36 release record could not be assessed; inspect it privately.");
    process.exitCode = 1;
  }
}

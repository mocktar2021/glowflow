import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

// This manual-only draft is pinned to the existing GlowFlow QA project. It
// installs no schedule, policy, secret, or booking feature flag.
const projectRef = "rfwhqutkiztxkagbhevp";
const projectOrigin = `https://${projectRef}.supabase.co`;
const executionAcknowledgement = "run-glowflow-qa-cleanup-only";

export class CleanupFailure extends Error {
  constructor(stage, code) {
    super("GlowFlow cleanup did not complete.");
    this.stage = stage;
    this.code = code;
  }
}

function boundedInteger(value, minimum, maximum) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function configuration(env) {
  if (env.GLOWFLOW_CLEANUP_EXECUTE !== executionAcknowledgement
    || env.GLOWFLOW_CLEANUP_PROJECT_REF !== projectRef) throw new CleanupFailure("preflight", "scope");
  let url;
  try { url = new URL(env.GLOWFLOW_CLEANUP_SUPABASE_URL); }
  catch { throw new CleanupFailure("preflight", "scope"); }
  if (url.origin !== projectOrigin || url.pathname !== "/" || url.search || url.hash
    || url.username || url.password) throw new CleanupFailure("preflight", "scope");
  const key = env.GLOWFLOW_CLEANUP_SERVICE_ROLE_KEY;
  if (typeof key !== "string" || key.length < 32 || /\s/.test(key)) {
    throw new CleanupFailure("preflight", "credentials");
  }
  const maxCalls = boundedInteger(env.GLOWFLOW_CLEANUP_MAX_CALLS_PER_SWEEP, 1, 25);
  const maxWallMs = boundedInteger(env.GLOWFLOW_CLEANUP_MAX_WALL_MS, 5_000, 60_000);
  const intentBatch = boundedInteger(env.GLOWFLOW_CLEANUP_INTENT_BATCH_LIMIT, 1, 100);
  const quotaBatch = boundedInteger(env.GLOWFLOW_CLEANUP_QUOTA_BATCH_LIMIT, 1, 1_000);
  if (!maxCalls || !maxWallMs || !intentBatch || !quotaBatch) {
    throw new CleanupFailure("preflight", "limits");
  }
  return { origin: projectOrigin, key, maxCalls, maxWallMs, intentBatch, quotaBatch };
}

function validCount(value, limit) {
  return Number.isSafeInteger(value) && value >= 0 && value <= limit;
}

function checkedResult(stage, value, batchLimit) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.complete !== "boolean") throw new CleanupFailure(stage, "response");
  if (value.busy === true) throw new CleanupFailure(stage, "busy");
  if (value.busy !== undefined && value.busy !== false) throw new CleanupFailure(stage, "response");
  if (stage === "intent") {
    if (!validCount(value.scrubbed, batchLimit) || !validCount(value.purged, batchLimit)
      || !validCount(value.sessions_purged, batchLimit)
      || value.scrubbed + value.purged + value.sessions_purged > batchLimit) {
      throw new CleanupFailure(stage, "response");
    }
    return { complete: value.complete, counts: {
      scrubbed: value.scrubbed, purged: value.purged, sessionsPurged: value.sessions_purged,
    } };
  }
  if (!validCount(value.removed, batchLimit)) throw new CleanupFailure(stage, "response");
  return { complete: value.complete, counts: { removed: value.removed } };
}

export async function drainSweeps(config, rpc, now = () => performance.now()) {
  const deadline = now() + config.maxWallMs;
  const summary = {};
  for (const [stage, batchLimit] of [["intent", config.intentBatch], ["quota", config.quotaBatch]]) {
    const counts = stage === "intent"
      ? { scrubbed: 0, purged: 0, sessionsPurged: 0 }
      : { removed: 0 };
    let complete = false;
    let calls = 0;
    while (calls < config.maxCalls) {
      const remainingMs = deadline - now();
      if (remainingMs <= 0) throw new CleanupFailure(stage, "deadline");
      let response;
      try { response = await rpc(stage, batchLimit, Math.min(10_000, remainingMs)); }
      catch { throw new CleanupFailure(stage, "transport"); }
      if (now() >= deadline) throw new CleanupFailure(stage, "deadline");
      const result = checkedResult(stage, response, batchLimit);
      calls += 1;
      for (const [name, value] of Object.entries(result.counts)) counts[name] += value;
      if (result.complete) { complete = true; break; }
    }
    // Both SQL sweeps clear their heartbeat before a partial pass and stamp it
    // only when complete. An undrained run must never be reported as healthy.
    if (!complete) throw new CleanupFailure(stage, "incomplete");
    summary[stage] = { calls, ...counts };
  }
  return summary;
}

function postgresRpc(config, fetchImpl) {
  return async (stage, batchLimit, timeoutMs) => {
    const name = stage === "intent" ? "sweep_public_booking_intents" : "sweep_public_booking_quota_counters";
    const response = await fetchImpl(`${config.origin}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ batch_limit: batchLimit }),
      signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
    });
    if (!response.ok) throw new Error("RPC unavailable");
    return response.json();
  };
}

export async function main(env = process.env, fetchImpl = globalThis.fetch, log = console.log) {
  let stage = "preflight";
  try {
    const config = configuration(env);
    stage = "intent";
    const summary = await drainSweeps(config, postgresRpc(config, fetchImpl));
    log(JSON.stringify({ event: "glowflow_booking_cleanup", scope: "glowflow_qa",
      status: "complete", intent: summary.intent, quota: summary.quota }));
    return 0;
  } catch (reason) {
    const failure = reason instanceof CleanupFailure ? reason : new CleanupFailure(stage, "unavailable");
    log(JSON.stringify({ event: "glowflow_booking_cleanup", scope: "glowflow_qa",
      status: "failed", stage: failure.stage, code: failure.code }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}

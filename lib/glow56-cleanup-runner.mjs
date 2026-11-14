import { main as runCleanup } from "../ops/booking-v2-cleanup.mjs";
import { run as signalHealthchecks, validatedPingUrl } from "../ops/booking-v2-healthcheck.mjs";

const supabaseUrl = "https://rfwhqutkiztxkagbhevp.supabase.co";
const reply = status => new Response(null, {
  status, headers: { "cache-control": "no-store" },
});

// Shared only after the caller-specific OIDC or Vercel Cron check passes.
export async function runGlow56Cleanup(env = process.env, dependencies = {}) {
  const { cleanup = runCleanup, healthcheck = signalHealthchecks,
    fetchImpl = globalThis.fetch, log = console.log } = dependencies;

  const key = env.SUPABASE_SECRET_KEY;
  const pingUrl = env.GLOWFLOW_QA_HEALTHCHECKS_PING_URL;
  if (typeof key !== "string" || key.length < 32 || /\s/.test(key)
    || !validatedPingUrl(pingUrl)) return reply(503);
  const healthEnv = { GLOWFLOW_QA_HEALTHCHECKS_PING_URL: pingUrl };
  const cleanupEnv = {
    GLOWFLOW_CLEANUP_EXECUTE: "run-glowflow-qa-cleanup-only",
    GLOWFLOW_CLEANUP_PROJECT_REF: "rfwhqutkiztxkagbhevp",
    GLOWFLOW_CLEANUP_SUPABASE_URL: supabaseUrl,
    GLOWFLOW_CLEANUP_SERVICE_ROLE_KEY: key,
    GLOWFLOW_CLEANUP_MAX_CALLS_PER_SWEEP: "25",
    GLOWFLOW_CLEANUP_MAX_WALL_MS: "45000",
    GLOWFLOW_CLEANUP_INTENT_BATCH_LIMIT: "100",
    GLOWFLOW_CLEANUP_QUOTA_BATCH_LIMIT: "1000",
  };
  try {
    const ready = await cleanup(cleanupEnv, fetchImpl, log);
    if (ready !== 0) {
      await healthcheck("fail", healthEnv, fetchImpl);
      return reply(503);
    }
    return reply(await healthcheck("ping", healthEnv, fetchImpl) ? 204 : 503);
  } catch {
    try { await healthcheck("fail", healthEnv, fetchImpl); } catch { /* missed ping still alerts */ }
    console.error("GLOW-56 QA cleanup failed without exposing credentials.");
    return reply(503);
  }
}

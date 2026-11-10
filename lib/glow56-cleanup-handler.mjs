import { main as runCleanup } from "../ops/booking-v2-cleanup.mjs";
import { run as signalHealthchecks, validatedPingUrl } from "../ops/booking-v2-healthcheck.mjs";
import { verifyScheduleToken } from "./glow56-cleanup-oidc.mjs";

const site = "glowflow.mocktar.com";
const supabaseUrl = "https://rfwhqutkiztxkagbhevp.supabase.co";
const activation = "enable-glow56-qa-oidc-cleanup-20261110";
const headers = { "cache-control": "no-store" };
const reply = status => new Response(null, { status, headers });

export async function handleGlow56Cleanup(request, env = process.env, dependencies = {}) {
  const { verify = verifyScheduleToken, cleanup = runCleanup,
    healthcheck = signalHealthchecks, fetchImpl = globalThis.fetch,
    log = console.log } = dependencies;
  let url;
  try { url = new URL(request.url); } catch { return reply(404); }
  if (request.method !== "POST"
    || env.GLOWFLOW_QA_OIDC_CLEANUP_ACTIVE !== activation
    || env.VERCEL_ENV !== "production"
    || env.NEXT_PUBLIC_SUPABASE_URL !== supabaseUrl
    || url.protocol !== "https:" || url.hostname !== site
    || request.headers.get("host") !== site
    || url.pathname !== "/api/internal/glow56-cleanup" || url.search || url.hash) {
    return reply(404);
  }
  const authorization = request.headers.get("authorization") || "";
  const token = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization)?.[1];
  if (!token || !await verify(token)) return reply(404);

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

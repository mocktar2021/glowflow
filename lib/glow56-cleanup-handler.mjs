import { verifyScheduleToken } from "./glow56-cleanup-oidc.mjs";
import { runGlow56Cleanup } from "./glow56-cleanup-runner.mjs";

const site = "glowflow.mocktar.com";
const supabaseUrl = "https://rfwhqutkiztxkagbhevp.supabase.co";
const activation = "enable-glow56-qa-oidc-cleanup-20261110";
const headers = { "cache-control": "no-store" };
const reply = status => new Response(null, { status, headers });

export async function handleGlow56Cleanup(request, env = process.env, dependencies = {}) {
  const { verify = verifyScheduleToken } = dependencies;
  let url;
  try { url = new URL(request.url); } catch { return reply(404); }
  if (request.method !== "POST"
    || env.GLOWFLOW_QA_OIDC_CLEANUP_ACTIVE !== activation
    || env.GLOWFLOW_QA_VERCEL_CLEANUP_ACTIVE === "enable-glow56-qa-vercel-cleanup-20261114"
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

  return runGlow56Cleanup(env, dependencies);
}

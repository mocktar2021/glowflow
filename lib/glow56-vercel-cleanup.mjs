import { timingSafeEqual } from "node:crypto";
import { runGlow56Cleanup } from "./glow56-cleanup-runner.mjs";

const site = "glowflow.mocktar.com";
const supabaseUrl = "https://rfwhqutkiztxkagbhevp.supabase.co";
const path = "/api/internal/glow56-vercel-cleanup";
const schedule = "17,47 * * * *";
const activation = "enable-glow56-qa-vercel-cleanup-20261114";
const reply = status => new Response(null, {
  status, headers: { "cache-control": "no-store" },
});

function validAuthorization(header, secret) {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 256
    || /\s/.test(secret) || typeof header !== "string") return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function handleVercelGlow56Cleanup(request, env = process.env, dependencies = {}) {
  let url;
  try { url = new URL(request.url); } catch { return reply(404); }
  if (request.method !== "GET"
    || env.GLOWFLOW_QA_VERCEL_CLEANUP_ACTIVE !== activation
    || env.VERCEL_ENV !== "production"
    || env.NEXT_PUBLIC_SUPABASE_URL !== supabaseUrl
    || url.protocol !== "https:" || url.hostname !== site
    || request.headers.get("host") !== site
    || url.pathname !== path || url.search || url.hash
    || request.headers.get("x-vercel-cron-schedule") !== schedule
    || !validAuthorization(request.headers.get("authorization"), env.CRON_SECRET)) {
    return reply(404);
  }
  return runGlow56Cleanup(env, dependencies);
}

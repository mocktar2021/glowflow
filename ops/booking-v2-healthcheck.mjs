import { pathToFileURL } from "node:url";

// The UUID is a bearer secret. Never put it in a command argument, log, or
// diagnostic body. Only the exact free Healthchecks success endpoint is valid.
export function validatedPingUrl(value) {
  if (typeof value !== "string") return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "hc-ping.com" || url.port
    || url.username || url.password || url.search || url.hash
    || !/^\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(url.pathname)
    || url.href !== value) return null;
  return url;
}

export async function run(mode, env = process.env, fetchImpl = globalThis.fetch) {
  if (mode !== "preflight" && mode !== "ping") return false;
  const url = validatedPingUrl(env.GLOWFLOW_QA_HEALTHCHECKS_PING_URL);
  if (!url) return false;
  if (mode === "preflight") return true;
  try {
    const response = await fetchImpl(url, {
      method: "POST", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return response.status === 200;
  } catch { return false; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const success = await run(process.argv[2]);
  if (!success) {
    console.error("GlowFlow QA cleanup healthcheck unavailable.");
    process.exitCode = 1;
  }
}

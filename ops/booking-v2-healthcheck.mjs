import { pathToFileURL } from "node:url";

// The UUID is a bearer secret. Never put it in a command argument, log, or
// diagnostic body. Only the exact free Healthchecks base endpoint is valid.
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

async function acceptedResponse(response) {
  // Healthchecks documents 200 for accepted, unknown, and rate-limited UUIDs.
  // Only its exact, documented "OK" body counts as accepted; bound the read.
  if (response.status !== 200) return false;
  const reader = response.body?.getReader();
  if (!reader) return false;
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 32) {
      void reader.cancel().catch(() => {});
      return false;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes) === "OK";
}

export async function run(mode, env = process.env, fetchImpl = globalThis.fetch) {
  if (mode !== "preflight" && mode !== "ping" && mode !== "fail") return false;
  const url = validatedPingUrl(env.GLOWFLOW_QA_HEALTHCHECKS_PING_URL);
  if (!url) return false;
  if (mode === "preflight") return true;
  // Derive the failure endpoint from a validated base; never accept a second
  // endpoint or interpolate an unchecked bearer URL.
  if (mode === "fail") url.pathname += "/fail";
  try {
    const response = await fetchImpl(url, {
      method: "POST", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return await acceptedResponse(response);
  } catch { return false; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const success = await run(process.argv[2]);
  if (!success) {
    console.error("GlowFlow QA cleanup healthcheck unavailable.");
    process.exitCode = 1;
  }
}

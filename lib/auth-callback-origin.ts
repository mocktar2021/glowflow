import { publicSiteOrigin } from "@/lib/public-site-origin";

const currentQaOrigin = "https://glowflow.mocktar.com";

/**
 * Build Auth email callbacks from trusted server configuration. Keep the
 * existing QA and Preview behavior until the owner approves a cutover, but
 * refuse a Production canonical/App URL mismatch before sending any Auth email.
 */
export function authCallbackOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.GLOWFLOW_APP_URL ?? currentQaOrigin;
  if (env.VERCEL_ENV !== "production" || env.GLOWFLOW_CANONICAL_ORIGIN === undefined) {
    return configured;
  }

  // Once a Production canonical origin is explicitly selected, Auth callbacks
  // must use that exact origin. Never silently fall back to the QA domain.
  if (!env.GLOWFLOW_APP_URL || configured !== configured.trim()) return null;
  try {
    const canonical = publicSiteOrigin(env);
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.origin !== canonical || url.username || url.password
        || url.port || url.pathname !== "/" || url.search || url.hash
        || (configured !== url.origin && configured !== `${url.origin}/`)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const currentProductionOrigin = "https://glowflow.mocktar.com";
const productionHosts = new Set(["glowflow.mocktar.com", "glowflow.beauty"]);

/** Public SEO origin, independent of request headers and visitor-supplied hosts. */
export function publicSiteOrigin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VERCEL_ENV === "production") {
    // Separate from Auth/sending so an unknown existing APP_URL cannot change SEO
    // during an ordinary code release. Set both together only at the cutover.
    const configured = env.GLOWFLOW_CANONICAL_ORIGIN;
    if (configured === undefined) return currentProductionOrigin;
    if (configured !== configured.trim()) throw new Error("Invalid GlowFlow production origin");
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" && productionHosts.has(url.hostname)
          && !url.username && !url.password && !url.port && url.pathname === "/"
          && !url.search && !url.hash
          && (configured === url.origin || configured === `${url.origin}/`)) return url.origin;
    } catch {
      // Invalid URLs follow the same fail-closed path as unapproved hosts.
    }
    throw new Error("Invalid GlowFlow production origin");
  }

  if (env.VERCEL_URL) {
    const url = new URL(`https://${env.VERCEL_URL}`);
    if (url.hostname.endsWith(".vercel.app") && env.VERCEL_URL === url.hostname) return url.origin;
    throw new Error("Invalid GlowFlow preview origin");
  }
  return "http://localhost:3000";
}

export function publicSiteUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid public site path");
  return `${publicSiteOrigin(env)}${path}`;
}

import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";

type QuotaKeys = { ipDigest: string; browserDigest: string | null };

const keyPattern = /^[A-Za-z0-9_-]{43}$/;

function hmacKey(env: NodeJS.ProcessEnv): Buffer | null {
  const encoded = env.GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY;
  if (!encoded || !keyPattern.test(encoded)) return null;
  const key = Buffer.from(encoded, "base64url");
  return key.length === 32 && key.toString("base64url") === encoded
    && !key.equals(Buffer.alloc(32)) ? key : null;
}

function canonicalClientIp(request: Request): string | null {
  // Vercel overwrites x-forwarded-for instead of forwarding a caller-supplied
  // value. Never select an address from a comma-separated chain or accept a
  // disagreeing Vercel copy. Direct/local callers must fail closed below.
  const forwarded = request.headers.get("x-forwarded-for");
  const vercelForwarded = request.headers.get("x-vercel-forwarded-for");
  if (!forwarded || forwarded !== forwarded.trim() || forwarded.includes(",")
    || (vercelForwarded !== null && vercelForwarded !== forwarded)) return null;

  const family = isIP(forwarded);
  if (family === 4) return forwarded;
  if (family !== 6) return null;
  try {
    const canonical = new URL(`http://[${forwarded}]/`).hostname.slice(1, -1);
    // An IPv4-mapped IPv6 address must share the IPv4 quota bucket.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
    if (mapped) {
      const high = Number.parseInt(mapped[1], 16);
      const low = Number.parseInt(mapped[2], 16);
      return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
    }
    return canonical;
  } catch {
    return null;
  }
}

/** Server-only input for the dormant GLOW-56 quota RPC; never send raw keys to PostgreSQL. */
export function publicBookingQuotaKeys(
  request: Request, browserToken: string | null, env: NodeJS.ProcessEnv = process.env,
): QuotaKeys | null {
  // Local/unknown runtimes cannot prove that the forwarding header was
  // rewritten by Vercel. This is not an authentication check for callers.
  if (env.VERCEL_ENV !== "production" && env.VERCEL_ENV !== "preview") return null;
  const key = hmacKey(env);
  const ip = canonicalClientIp(request);
  if (!key || !ip || (browserToken !== null && (!browserToken || browserToken.length > 256))) return null;

  const digest = (scope: "ip" | "browser", value: string) => createHmac("sha256", key)
    .update(`glowflow:public-booking-quota:v1:${scope}\0`)
    .update(value).digest("hex");
  return { ipDigest: digest("ip", ip), browserDigest: browserToken === null ? null : digest("browser", browserToken) };
}

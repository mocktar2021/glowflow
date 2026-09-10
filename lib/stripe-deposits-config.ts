import { sandboxConfiguration } from "./stripe-sandbox-config";

/** Preview-only sandbox gate, with no alternate project fallback. */
export function sandboxDepositConfiguration(env: Record<string, string | undefined>) {
  if (env.GLOWFLOW_STRIPE_SANDBOX_DEPOSITS !== "true" || env.VERCEL_ENV !== "preview") return null;
  if (env.NEXT_PUBLIC_SUPABASE_URL !== "https://rfwhqutkiztxkagbhevp.supabase.co") return null;
  return sandboxConfiguration(env);
}

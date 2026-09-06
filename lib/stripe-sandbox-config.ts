export function sandboxConfiguration(env: Record<string, string | undefined>) {
  if (env.GLOWFLOW_STRIPE_SANDBOX_ONBOARDING !== "true") return null;
  if (!/^rk_test_\S+$/.test(env.STRIPE_RESTRICTED_KEY ?? "")) return null;
  if (env.STRIPE_SANDBOX_ACCOUNT_ID !== "acct_1UCiSZDNDjGEQe6f") return null;
  try {
    const url = new URL(env.GLOWFLOW_APP_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return { origin: url.origin, platformAccountId: env.STRIPE_SANDBOX_ACCOUNT_ID };
  } catch {
    return null;
  }
}

export function creationWindowOpen(createdAt: string, now = Date.now()) {
  const age = now - Date.parse(createdAt);
  // Stripe may prune idempotency keys after 24h. Require reconciliation thereafter.
  return Number.isFinite(age) && age >= 0 && age < 23 * 60 * 60 * 1000;
}

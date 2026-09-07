import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createStripeClient } from "@/lib/stripe";
import { creationWindowOpen, sandboxConfiguration } from "@/lib/stripe-sandbox-config";

export async function sandboxOwner() {
  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) return null;
  const { data: tenant } = await supabase.from("tenants")
    .select("id,name,country_code,currency")
    .eq("owner_id", auth.user.id).single();
  if (!tenant) return null;
  return { tenant, supabase };
}

export async function sandboxOnboardingUrl(locale: "fr" | "en" | "es") {
  const owner = await sandboxOwner();
  if (!owner) throw new Error("owner_required");
  const config = sandboxConfiguration(process.env);
  if (!config) throw new Error("sandbox_unavailable");
  const { tenant } = owner;
  const { data: market } = await owner.supabase.from("markets")
    .select("status,payment_methods").eq("country_code", tenant.country_code).single();
  if (!market || market.status !== "active" || !market.payment_methods.includes("card") ||
      !["FR", "US", "ES"].includes(tenant.country_code)) throw new Error("market_unavailable");
  const stripe = createStripeClient();
  // A test key alone cannot distinguish two sandboxes. Verify the platform too.
  const platform = await stripe.accounts.retrieve(null);
  if (platform.id !== config.platformAccountId) throw new Error("sandbox_unavailable");
  const admin = createAdminClient();
  const { error: reserveError } = await admin.from("stripe_sandbox_connections")
    .upsert({ tenant_id: tenant.id }, { onConflict: "tenant_id", ignoreDuplicates: true });
  if (reserveError) throw new Error("sandbox_unavailable");
  const { data: connection, error } = await admin.from("stripe_sandbox_connections")
    .select("stripe_account_id,created_at").eq("tenant_id", tenant.id).single();
  if (error || !connection) throw new Error("sandbox_unavailable");
  let accountId: string | null = connection.stripe_account_id;
  if (!accountId) {
    if (!creationWindowOpen(connection.created_at)) throw new Error("reconciliation_required");
    const account = await stripe.v2.core.accounts.create({
      display_name: tenant.name,
      identity: { country: tenant.country_code.toLowerCase() },
      dashboard: "full",
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { currency: tenant.currency.toLowerCase(), responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
      metadata: { tenant_id: tenant.id, product: "glowflow", environment: "sandbox" },
    }, { idempotencyKey: `glowflow-sandbox-owner-${tenant.id}` });
    if (account.livemode) throw new Error("sandbox_unavailable");
    const { error: saveError } = await admin.from("stripe_sandbox_connections")
      .update({ stripe_account_id: account.id }).eq("tenant_id", tenant.id).is("stripe_account_id", null);
    if (saveError) throw new Error("sandbox_unavailable");
    accountId = account.id;
  }
  const account = await stripe.v2.core.accounts.retrieve(accountId);
  if (account.livemode || account.metadata?.tenant_id !== tenant.id || account.metadata?.environment !== "sandbox") {
    throw new Error("sandbox_unavailable");
  }
  const base = `${config.origin}/${locale}/dashboard/payments`;
  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: { type: "account_onboarding", account_onboarding: {
      configurations: ["merchant"], refresh_url: `${base}?refresh=1`, return_url: `${base}?returned=1`,
    } },
  });
  if (link.livemode) throw new Error("sandbox_unavailable");
  return link.url;
}

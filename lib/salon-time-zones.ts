import { createClient } from "@supabase/supabase-js";

import type { SalonSearchResult } from "@/lib/salon-search";

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

type PublicClientConfig = { url: string; key: string; fetch: typeof fetch };

// The public search RPC intentionally excludes tenant details. Resolve only the
// published slug/tenant ID pair, then the tenant's publicly granted time zone.
// Use a separate anonymous client: a signed-in marketplace visitor does not
// inherit the anon-only tenants_public_booking_select RLS policy.
export async function publicSalonTimeZones(
  salons: Pick<SalonSearchResult, "slug">[],
  config?: PublicClientConfig,
): Promise<Record<string, string>> {
  const slugs = [...new Set(salons.map((salon) => salon.slug))];
  if (!slugs.length) return {};
  const url = config?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = config?.key ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return {};
  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: config?.fetch ?? fetch },
    });

    const { data: profiles, error: profileError } = await supabase
      .from("salon_public_profiles")
      .select("slug, tenant_id")
      .in("slug", slugs);
    if (profileError || !profiles?.length) return {};

    const tenantIds = [...new Set(profiles.map((profile) => profile.tenant_id))];
    const { data: tenants, error: tenantError } = await supabase
      .from("tenants")
      .select("id, time_zone")
      .in("id", tenantIds);
    if (tenantError || !tenants?.length) return {};

    const zonesByTenant = new Map(tenants
      .filter((tenant) => typeof tenant.time_zone === "string" && validTimeZone(tenant.time_zone))
      .map((tenant) => [tenant.id, tenant.time_zone]));
    return Object.fromEntries(profiles
      .filter((profile) => zonesByTenant.has(profile.tenant_id))
      .map((profile) => [profile.slug, zonesByTenant.get(profile.tenant_id)!]));
  } catch {
    return {};
  }
}

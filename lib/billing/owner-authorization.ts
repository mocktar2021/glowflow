import "server-only";

import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

/**
 * Inert GLOW-53 billing boundary. A future owner-only Checkout or Portal route
 * must derive the salon from the authenticated user and database membership,
 * never from a browser-supplied tenant ID, country, currency, or Stripe ID.
 *
 * RLS remains authoritative. This extra join refuses inconsistent owner,
 * membership, or tenant records before any future platform billing call.
 */
export async function resolveBillingOwnerContext() {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return { kind: "unavailable" } as const;
  }

  let userId: unknown;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return { kind: "unavailable" } as const;
    userId = data.user?.id;
  } catch {
    return { kind: "unavailable" } as const;
  }
  if (!isUuid(userId)) return { kind: "authentication_required" } as const;

  try {
    const { data: member, error: memberError } = await supabase.from("users")
      .select("id,tenant_id,role").eq("id", userId).single();
    if (memberError) return { kind: "unavailable" } as const;
    if (!member || member.id !== userId || member.role !== "owner"
      || !isUuid(member.tenant_id)) return { kind: "owner_required" } as const;

    const { data: tenant, error: tenantError } = await supabase.from("tenants")
      .select("id,owner_id,country_code,currency").eq("id", member.tenant_id).single();
    if (tenantError) return { kind: "unavailable" } as const;
    if (!tenant || tenant.id !== member.tenant_id || tenant.owner_id !== userId)
      return { kind: "owner_required" } as const;
    if (typeof tenant.country_code !== "string"
      || !/^[A-Z]{2}$/.test(tenant.country_code)
      || typeof tenant.currency !== "string"
      || !/^[A-Z]{3}$/.test(tenant.currency))
      return { kind: "unavailable" } as const;

    return {
      kind: "owner",
      ownerId: userId,
      tenantId: tenant.id,
      operatingCountryCode: tenant.country_code,
      operatingCurrency: tenant.currency,
      supabase,
    } as const;
  } catch {
    return { kind: "unavailable" } as const;
  }
}

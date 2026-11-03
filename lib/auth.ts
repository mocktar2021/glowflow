import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isLocale, type Locale } from "@/lib/i18n";

export function safeLocale(value: string): Locale {
  return isLocale(value) ? value : "fr";
}

export async function requireUser(locale: Locale) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;

  if (!userId) {
    redirect(`/${locale}/login`);
  }

  return { supabase, userId };
}

export async function ensureOwnerWorkspace() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return { error: "authentication_required" };
  }

  const metadata = authData.user.user_metadata;
  if (metadata.glowflow_account_intent === "staff_invitation") {
    // User metadata is editable: this marker only suppresses onboarding.
    // It never authorizes staff access; the database membership does that.
    // Existing staff may use the normal sign-in screen after acceptance.
    // Before acceptance, never turn an invited Auth identity into an owner.
    const { data: membership, error: membershipError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", authData.user.id)
      .maybeSingle();
    return { error: !membershipError && membership?.tenant_id ? null : "staff_invitation_required" };
  }
  const { error } = await supabase.rpc("create_owner_workspace", {
    salon_name: metadata.salon_name ?? "My Salon",
    requested_slug: metadata.salon_slug ?? "my-salon",
    owner_full_name: metadata.full_name ?? authData.user.email ?? "Salon owner",
    owner_locale: metadata.locale ?? "fr",
    salon_country_code: metadata.country_code ?? "FR",
    salon_time_zone: metadata.time_zone ?? "Europe/Paris",
    salon_address_line1: metadata.address_line1 ?? "",
    salon_city: metadata.city ?? "",
    salon_postal_code: metadata.postal_code ?? "",
    salon_administrative_area: metadata.administrative_area ?? "",
  });

  return { error: error?.message ?? null };
}

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
  const { error } = await supabase.rpc("create_owner_workspace", {
    salon_name: metadata.salon_name ?? "My Salon",
    requested_slug: metadata.salon_slug ?? "my-salon",
    owner_full_name: metadata.full_name ?? authData.user.email ?? "Salon owner",
    owner_locale: metadata.locale ?? "fr",
    workspace_currency: metadata.currency ?? "EUR",
  });

  return { error: error?.message ?? null };
}

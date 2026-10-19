"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { clientFields, clientIdSchema, clientMember, findClients, searchSchema, type ClientSummary } from "@/lib/clients";
import type { Locale } from "@/lib/i18n";

export type SearchState = { error: string | null; rows: ClientSummary[] };
export type SaveState = { error: string | null; saved: boolean };

export async function searchClients(locale: Locale, _previous: SearchState, formData: FormData): Promise<SearchState> {
  const { supabase, tenantId } = await clientMember(locale);
  const parsed = searchSchema.safeParse(String(formData.get("search") ?? ""));
  if (!parsed.success) return { error: "invalid", rows: [] };
  try {
    return { error: null, rows: await findClients(supabase, tenantId, parsed.data) };
  } catch {
    return { error: "load", rows: [] };
  }
}

export async function saveClient(locale: Locale, id: string | null, _previous: SaveState, formData: FormData): Promise<SaveState> {
  const { supabase, tenantId } = await clientMember(locale);
  if (id !== null && !clientIdSchema.safeParse(id).success) return { error: "invalid", saved: false };
  const parsed = clientFields(formData);
  if (!parsed.success) return { error: "invalid", saved: false };
  const value = parsed.data;
  const fields = {
    full_name: value.full_name,
    email: value.email || null,
    phone: value.phone || null,
    notes: value.notes || null,
    preferred_locale: value.preferred_locale,
  };
  const result = id
    ? await supabase.from("clients").update(fields).eq("tenant_id", tenantId).eq("id", id).select("id").maybeSingle()
    : await supabase.from("clients").insert({ ...fields, tenant_id: tenantId }).select("id").single();
  if (result.error || !result.data) return { error: "save", saved: false };
  revalidatePath(`/${locale}/dashboard/clients`);
  revalidatePath(`/${locale}/dashboard/clients/${result.data.id}`);
  if (!id) redirect(`/${locale}/dashboard/clients/${result.data.id}`);
  return { error: null, saved: true };
}

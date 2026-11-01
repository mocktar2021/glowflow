import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";
export { clientFields, clientIdSchema, searchSchema } from "./client-validation";

export type ClientSummary = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  preferred_locale: Locale;
};

export type ClientProfile = ClientSummary & { notes: string | null; created_at: string; nail_preferences: unknown };

export async function clientMember(locale: Locale) {
  const { supabase, userId } = await requireUser(locale);
  const { data: member, error } = await supabase.from("users")
    .select("tenant_id,role").eq("id", userId).single();
  if (error || !member?.tenant_id || !["owner", "staff"].includes(member.role)) redirect(`/${locale}/dashboard`);
  return { supabase, tenantId: member.tenant_id as string };
}

export async function findClients(
  supabase: Awaited<ReturnType<typeof clientMember>>["supabase"], tenantId: string, term: string,
): Promise<ClientSummary[]> {
  const columns = "id,full_name,phone,email,preferred_locale";
  const base = () => supabase.from("clients").select(columns).eq("tenant_id", tenantId);
  if (!term) {
    const { data, error } = await base().order("full_name").limit(30);
    if (error) throw new Error("Unable to load client directory");
    return (data ?? []) as ClientSummary[];
  }
  // Search each field separately so user input never enters a PostgREST filter expression.
  const escaped = term.replace(/[\\%_]/g, "\\$&");
  const results = await Promise.all(
    (["full_name", "email", "phone"] as const).map((column) => base().ilike(column, `%${escaped}%`).order("full_name").limit(30)),
  );
  if (results.some(({ error }) => error)) throw new Error("Unable to search client directory");
  const distinct = new Map<string, ClientSummary>();
  for (const { data } of results) for (const row of (data ?? []) as ClientSummary[]) distinct.set(row.id, row);
  return [...distinct.values()].sort((a, b) => a.full_name.localeCompare(b.full_name)).slice(0, 30);
}

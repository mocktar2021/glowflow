import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceShell } from "@/components/glowflow/workspace-shell";
import { clientIdSchema, clientMember, type ClientProfile } from "@/lib/clients";
import { isLocale } from "@/lib/i18n";
import { readNailPreferences } from "@/lib/nail-preferences";
import { ClientForm } from "../client-form";
import { cardClass, copy } from "../copy";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

type Appointment = { id: string; service_title_json: Record<string, string>; start_time: string; status: "confirmed" | "completed" | "canceled" | "no_show" };

export default async function ClientProfilePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale) || !clientIdSchema.safeParse(id).success) notFound();
  const { supabase, tenantId } = await clientMember(locale);
  const { data, error } = await supabase.from("clients")
    .select("id,full_name,phone,email,notes,preferred_locale,created_at,nail_preferences")
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error || !data) notFound();
  const row = data as ClientProfile & { nail_preferences: unknown };
  // ClientForm is a client component. Pass only its explicit fields so the
  // raw JSONB object and any unknown private keys never enter the RSC payload.
  const client: ClientProfile = {
    id: row.id, full_name: row.full_name, phone: row.phone, email: row.email,
    preferred_locale: row.preferred_locale, notes: row.notes, created_at: row.created_at,
  };
  const [{ data: rawHistory, error: historyError }, { data: tenant, error: tenantError }] = await Promise.all([
    supabase.from("appointments").select("id,service_title_json,start_time,status")
      .eq("tenant_id", tenantId).eq("client_id", id).order("start_time", { ascending: false }).limit(20),
    supabase.from("tenants").select("time_zone").eq("id", tenantId).single(),
  ]);
  if (historyError) throw new Error("Unable to load client appointment history");
  if (tenantError || !tenant) throw new Error("Unable to load salon time zone");
  const history = (rawHistory ?? []) as Appointment[];
  const labels = copy[locale];
  const nails = readNailPreferences(row.nail_preferences);
  const nailFields = [
    [labels.nailShape, nails.shape],
    [labels.nailProductType, nails.productType],
    [labels.nailShade, nails.shade],
    [labels.nailDesignNotes, nails.designNotes],
    [labels.lastInfill, nails.lastInfillDate && new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${nails.lastInfillDate}T12:00:00Z`))],
  ].filter((field): field is [string, string] => Boolean(field[1]));
  return <WorkspaceShell locale={locale} active="clients"><main className="min-h-screen bg-background px-5 pb-28 pt-10 text-foreground sm:px-8 lg:pb-10">
    <div className="mx-auto max-w-4xl">
      <Link href={`/${locale}/dashboard/clients`} className="text-sm font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-primary">{labels.directory}</Link>
      <h1 className="mt-5 font-display text-4xl font-medium sm:text-5xl">{client.full_name}</h1>
      <div className="mt-8 grid gap-6">
        <ClientForm locale={locale} client={client} />
        <section className={cardClass} aria-labelledby="nail-preferences-title">
          <h2 id="nail-preferences-title" className="text-xl font-semibold">{labels.nailPreferences}</h2>
          {!nailFields.length ? <p className="mt-3 text-muted-foreground">{labels.noNailPreferences}</p> :
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">{nailFields.map(([label, value]) =>
              <div key={label} className="min-w-0">
                <dt className="text-sm font-semibold text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words whitespace-pre-wrap">{value}</dd>
              </div>)}</dl>}
        </section>
        <section className={cardClass}>
          <h2 className="text-xl font-semibold">{labels.history}</h2>
          {!history.length ? <p className="mt-3 text-muted-foreground">{labels.noHistory}</p> :
            <ul className="mt-3 divide-y divide-border">{history.map((appointment) => {
              const title = appointment.service_title_json;
              const serviceName = title?.[locale] || title?.fr || title?.en || title?.es || labels.history;
              return <li key={appointment.id} className="flex flex-wrap justify-between gap-2 py-3">
                <span className="font-medium">{serviceName}</span>
                <span className="text-sm text-muted-foreground">
                  {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: tenant.time_zone }).format(new Date(appointment.start_time))} · {tenant.time_zone} · {labels[appointment.status]}
                </span>
              </li>;
            })}</ul>}
        </section>
      </div>
    </div>
  </main></WorkspaceShell>;
}

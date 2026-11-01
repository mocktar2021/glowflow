import Link from "next/link";
import { notFound } from "next/navigation";

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
  const client = data as ClientProfile;
  const [{ data: rawHistory, error: historyError }, { data: tenant, error: tenantError }] = await Promise.all([
    supabase.from("appointments").select("id,service_title_json,start_time,status")
      .eq("tenant_id", tenantId).eq("client_id", id).order("start_time", { ascending: false }).limit(20),
    supabase.from("tenants").select("time_zone").eq("id", tenantId).single(),
  ]);
  if (historyError) throw new Error("Unable to load client appointment history");
  if (tenantError || !tenant) throw new Error("Unable to load salon time zone");
  const history = (rawHistory ?? []) as Appointment[];
  const labels = copy[locale];
  const nails = readNailPreferences(client.nail_preferences);
  const nailFields = [
    [labels.nailShape, nails.shape],
    [labels.nailProductType, nails.productType],
    [labels.nailShade, nails.shade],
    [labels.nailDesignNotes, nails.designNotes],
    [labels.lastInfill, nails.lastInfillDate && new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${nails.lastInfillDate}T12:00:00Z`))],
  ].filter((field): field is [string, string] => Boolean(field[1]));
  return <main className="min-h-screen bg-[#faf9f6] px-5 py-10 text-slate-950 dark:bg-[#0f1115] dark:text-stone-50 sm:px-8">
    <div className="mx-auto max-w-4xl">
      <Link href={`/${locale}/dashboard/clients`} className="text-sm font-semibold text-[#925723] underline dark:text-[#e8bb82]">{labels.directory}</Link>
      <h1 className="mt-5 text-3xl font-semibold">{client.full_name}</h1>
      <div className="mt-8 grid gap-6">
        <ClientForm locale={locale} client={client} />
        <section className={cardClass} aria-labelledby="nail-preferences-title">
          <h2 id="nail-preferences-title" className="text-xl font-semibold">{labels.nailPreferences}</h2>
          {!nailFields.length ? <p className="mt-3 text-slate-600 dark:text-stone-300">{labels.noNailPreferences}</p> :
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">{nailFields.map(([label, value]) =>
              <div key={label} className="min-w-0">
                <dt className="text-sm font-semibold text-slate-600 dark:text-stone-300">{label}</dt>
                <dd className="mt-1 break-words whitespace-pre-wrap">{value}</dd>
              </div>)}</dl>}
        </section>
        <section className={cardClass}>
          <h2 className="text-xl font-semibold">{labels.history}</h2>
          {!history.length ? <p className="mt-3 text-slate-600 dark:text-stone-300">{labels.noHistory}</p> :
            <ul className="mt-3 divide-y divide-[#e4d6c5] dark:divide-white/10">{history.map((appointment) => {
              const title = appointment.service_title_json;
              const serviceName = title?.[locale] || title?.fr || title?.en || title?.es || labels.history;
              return <li key={appointment.id} className="flex flex-wrap justify-between gap-2 py-3">
                <span className="font-medium">{serviceName}</span>
                <span className="text-sm text-slate-600 dark:text-stone-300">
                  {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: tenant.time_zone }).format(new Date(appointment.start_time))} · {tenant.time_zone} · {labels[appointment.status]}
                </span>
              </li>;
            })}</ul>}
        </section>
      </div>
    </div>
  </main>;
}

import { ArrowLeft, Archive, Clock3, Plus, RotateCcw, Save, Scissors, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { createService, setServiceActive, updateService } from "./actions";

export const dynamic = "force-dynamic";

type Service = {
  id: string;
  title_json: Record<string, string>;
  duration_minutes: number;
  sanitation_buffer_minutes: number;
  price: number;
  deposit_amount: number;
  category: "hair" | "nails" | "other";
  station_name: string | null;
  currency: string;
  is_active: boolean;
};

type StaffMember = { id: string; full_name: string; role: string };

const copy = {
  fr: {
    title: "Catalogue de prestations", subtitle: "Gérez les prix, acomptes, durées, postes et membres éligibles.", back: "Tableau de bord",
    add: "Ajouter une prestation", active: "Prestations actives", archived: "Prestations archivées", empty: "Aucune prestation pour le moment.",
    titleFr: "Nom en français", titleEn: "Nom en anglais", titleEs: "Nom en espagnol", category: "Catégorie", hair: "Coiffure", nails: "Ongles", other: "Autre",
    duration: "Durée (minutes)", buffer: "Nettoyage (minutes)", price: "Prix", deposit: "Acompte", station: "Poste ou fauteuil", staff: "Membres éligibles",
    allStaff: "Sans sélection, toute l’équipe est éligible.", create: "Créer", save: "Enregistrer", archive: "Archiver", restore: "Réactiver",
    success: "Catalogue enregistré.", error: "La modification a échoué. Vérifiez les champs et réessayez.", owner: "Seul le propriétaire gère le catalogue.",
  },
  en: {
    title: "Service catalog", subtitle: "Manage prices, deposits, durations, stations, and eligible team members.", back: "Dashboard",
    add: "Add a service", active: "Active services", archived: "Archived services", empty: "No services yet.",
    titleFr: "French name", titleEn: "English name", titleEs: "Spanish name", category: "Category", hair: "Hair", nails: "Nails", other: "Other",
    duration: "Duration (minutes)", buffer: "Cleanup (minutes)", price: "Price", deposit: "Deposit", station: "Station or chair", staff: "Eligible team members",
    allStaff: "With no selection, the whole team is eligible.", create: "Create service", save: "Save", archive: "Archive", restore: "Restore",
    success: "Catalog saved.", error: "The change failed. Review the fields and try again.", owner: "Only the owner manages the catalog.",
  },
  es: {
    title: "Catálogo de servicios", subtitle: "Gestiona precios, depósitos, duraciones, puestos y miembros elegibles.", back: "Panel",
    add: "Añadir un servicio", active: "Servicios activos", archived: "Servicios archivados", empty: "Aún no hay servicios.",
    titleFr: "Nombre en francés", titleEn: "Nombre en inglés", titleEs: "Nombre en español", category: "Categoría", hair: "Cabello", nails: "Uñas", other: "Otro",
    duration: "Duración (minutos)", buffer: "Limpieza (minutos)", price: "Precio", deposit: "Depósito", station: "Puesto o silla", staff: "Miembros elegibles",
    allStaff: "Sin selección, todo el equipo es elegible.", create: "Crear servicio", save: "Guardar", archive: "Archivar", restore: "Reactivar",
    success: "Catálogo guardado.", error: "El cambio falló. Revisa los campos e inténtalo de nuevo.", owner: "Solo el propietario gestiona el catálogo.",
  },
} as const;

const inputClass = "mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5";
const cardClass = "rounded-[1.75rem] border border-[#e4d6c5] bg-white p-5 shadow-[0_12px_36px_rgba(48,32,18,0.06)] dark:border-white/10 dark:bg-[#17191e] sm:p-7";

function amount(value: number) {
  return (value / 100).toFixed(2);
}

function Fields({ labels, service, staff, selected = [] }: {
  labels: typeof copy.fr | typeof copy.en | typeof copy.es;
  service?: Service;
  staff: StaffMember[];
  selected?: string[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium">{labels.titleFr}<input required name="title_fr" maxLength={120} defaultValue={service?.title_json.fr ?? ""} className={inputClass} /></label>
      <label className="text-sm font-medium">{labels.titleEn}<input required name="title_en" maxLength={120} defaultValue={service?.title_json.en ?? ""} className={inputClass} /></label>
      <label className="text-sm font-medium">{labels.titleEs}<input required name="title_es" maxLength={120} defaultValue={service?.title_json.es ?? ""} className={inputClass} /></label>
      <label className="text-sm font-medium">{labels.category}<select name="category" defaultValue={service?.category ?? "hair"} className={inputClass}><option value="hair">{labels.hair}</option><option value="nails">{labels.nails}</option><option value="other">{labels.other}</option></select></label>
      <label className="text-sm font-medium">{labels.duration}<input required name="duration_minutes" type="number" min={5} max={720} step={5} defaultValue={service?.duration_minutes ?? 60} className={inputClass} /></label>
      <label className="text-sm font-medium">{labels.buffer}<input required name="sanitation_buffer_minutes" type="number" min={0} max={120} step={5} defaultValue={service?.sanitation_buffer_minutes ?? 10} className={inputClass} /></label>
      <label className="text-sm font-medium">{labels.price} ({service?.currency ?? "EUR"})<input required name="price" inputMode="decimal" pattern="\\d+(?:[.,]\\d{1,2})?" defaultValue={amount(service?.price ?? 0)} className={inputClass} /></label>
      <label className="text-sm font-medium">{labels.deposit} ({service?.currency ?? "EUR"})<input required name="deposit" inputMode="decimal" pattern="\\d+(?:[.,]\\d{1,2})?" defaultValue={amount(service?.deposit_amount ?? 0)} className={inputClass} /></label>
      <label className="text-sm font-medium sm:col-span-2">{labels.station}<input name="station_name" maxLength={120} defaultValue={service?.station_name ?? ""} className={inputClass} /></label>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-semibold">{labels.staff}</legend>
        <p className="mt-1 text-xs text-slate-500">{labels.allStaff}</p>
        <div className="mt-3 flex flex-wrap gap-3">{staff.map((member) => <label key={member.id} className="flex items-center gap-2 rounded-full border border-[#dfd2c1] px-4 py-2 text-sm"><input type="checkbox" name="staff_ids" value={member.id} defaultChecked={selected.includes(member.id)} className="accent-[#a56d37]" />{member.full_name}</label>)}</div>
      </fieldset>
    </div>
  );
}

export default async function ServicesPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const labels = copy[locale];
  const query = await searchParams;
  const { supabase, userId } = await requireUser(locale);
  const { data: owner } = await supabase.from("users").select("tenant_id, role").eq("id", userId).single();
  if (!owner?.tenant_id || owner.role !== "owner") notFound();

  const [{ data: rawServices }, { data: rawStaff }, { data: rawAssignments }, { data: tenant }] = await Promise.all([
    supabase.from("services").select("id,title_json,duration_minutes,sanitation_buffer_minutes,price,deposit_amount,category,station_name,currency,is_active").eq("tenant_id", owner.tenant_id).order("is_active", { ascending: false }).order("created_at"),
    supabase.from("users").select("id,full_name,role").eq("tenant_id", owner.tenant_id).order("full_name"),
    supabase.from("service_staff").select("service_id,staff_id").eq("tenant_id", owner.tenant_id),
    supabase.from("tenants").select("currency").eq("id", owner.tenant_id).single(),
  ]);

  const services = (rawServices ?? []) as Service[];
  const staff = (rawStaff ?? []) as StaffMember[];
  const assignments = rawAssignments ?? [];
  const active = services.filter((service) => service.is_active);
  const archived = services.filter((service) => !service.is_active);
  const selectedFor = (id: string) => assignments.filter((row) => row.service_id === id).map((row) => row.staff_id);

  return (
    <main className="min-h-screen bg-[#faf9f6] px-4 py-8 text-slate-950 dark:bg-[#101216] dark:text-stone-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <Link href={`/${locale}/dashboard`} className="inline-flex items-center gap-2 text-sm font-semibold text-[#9a602d] hover:underline dark:text-[#efc992]"><ArrowLeft className="size-4" />{labels.back}</Link>
        <div className="mt-4 flex items-start gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-[#f1dfc8] text-[#9a602d]"><Scissors className="size-6" /></span><div><h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{labels.title}</h1><p className="mt-2 text-slate-600 dark:text-stone-300">{labels.subtitle}</p></div></div>
        {query.saved ? <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{labels.success}</p> : null}
        {query.error ? <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{query.error === "owner_required" ? labels.owner : labels.error}</p> : null}

        <section className={`${cardClass} mt-6`}>
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Plus className="size-5 text-[#a56d37]" />{labels.add}</h2>
          <form action={createService.bind(null, locale)} className="mt-5">
            <Fields labels={labels} staff={staff} service={{ id: "", title_json: {}, duration_minutes: 60, sanitation_buffer_minutes: 10, price: 0, deposit_amount: 0, category: "hair", station_name: null, currency: tenant?.currency ?? "EUR", is_active: true }} />
            <button type="submit" className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white dark:bg-[#e8bb82] dark:text-slate-950"><Plus className="size-4" />{labels.create}</button>
          </form>
        </section>

        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><ShieldCheck className="size-5 text-emerald-600" />{labels.active}</h2>
          <div className="mt-4 grid gap-5">{active.length ? active.map((service) => <article key={service.id} className={cardClass}>
            <form action={updateService.bind(null, locale)}><input type="hidden" name="service_id" value={service.id} /><Fields labels={labels} service={service} staff={staff} selected={selectedFor(service.id)} /><button type="submit" className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white dark:bg-[#e8bb82] dark:text-slate-950"><Save className="size-4" />{labels.save}</button></form>
            <form action={setServiceActive.bind(null, locale)} className="mt-3"><input type="hidden" name="service_id" value={service.id} /><input type="hidden" name="active" value="false" /><button type="submit" className="inline-flex h-10 items-center gap-2 rounded-full border border-rose-200 px-4 text-sm font-semibold text-rose-700"><Archive className="size-4" />{labels.archive}</button></form>
          </article>) : <p className="rounded-2xl border border-dashed border-[#d9c7b2] p-6 text-slate-500">{labels.empty}</p>}</div>
        </section>

        {archived.length ? <section className="mt-8"><h2 className="flex items-center gap-2 text-xl font-semibold"><Clock3 className="size-5 text-[#a56d37]" />{labels.archived}</h2><div className="mt-4 grid gap-3">{archived.map((service) => <article key={service.id} className="flex flex-col gap-3 rounded-2xl border border-[#e4d6c5] bg-white p-5 dark:border-white/10 dark:bg-[#17191e] sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold">{service.title_json[locale] ?? service.title_json.fr}</h3><p className="mt-1 text-sm text-slate-500">{service.duration_minutes} min · {amount(service.price)} {service.currency}</p></div><form action={setServiceActive.bind(null, locale)}><input type="hidden" name="service_id" value={service.id} /><input type="hidden" name="active" value="true" /><button type="submit" className="inline-flex h-10 items-center gap-2 rounded-full border border-[#d9c7b2] px-4 text-sm font-semibold"><RotateCcw className="size-4" />{labels.restore}</button></form></article>)}</div></section> : null}
      </div>
    </main>
  );
}

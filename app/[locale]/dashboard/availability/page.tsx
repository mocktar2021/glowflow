import { ArrowLeft, CalendarClock, Coffee, Save, Trash2, UserRound, Warehouse } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { addScheduleException, deleteScheduleException, saveStaffHours, saveStationHours } from "./actions";

export const dynamic = "force-dynamic";

type HourRow = {
  staff_id?: string;
  station_name?: string;
  weekday: number;
  start_local: string;
  end_local: string;
  is_enabled: boolean;
};

type ScheduleException = {
  id: string;
  staff_id: string;
  kind: "break" | "time_off";
  starts_at: string;
  ends_at: string;
  note: string | null;
};

const copy = {
  fr: {
    title: "Disponibilités", subtitle: "Configurez les horaires de l’équipe, les pauses, les absences et les postes.", back: "Tableau de bord",
    staffHours: "Horaires de l’équipe", stationHours: "Horaires des postes", exceptions: "Pauses et absences",
    timeZone: "Fuseau horaire du salon", open: "Ouvert", start: "Début", end: "Fin", save: "Enregistrer",
    addException: "Ajouter une pause ou absence", staff: "Membre", kind: "Type", break: "Pause", timeOff: "Absence",
    from: "Du", to: "Au", note: "Note", add: "Ajouter", remove: "Supprimer", empty: "Aucune pause ou absence enregistrée.",
    success: "Disponibilités enregistrées.", error: "La modification a échoué. Vérifiez les horaires.", owner: "Seul le propriétaire modifie les disponibilités.",
    noStations: "Ajoutez un poste ou fauteuil à une prestation pour configurer ses horaires.",
    days: ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"],
  },
  en: {
    title: "Availability", subtitle: "Set team hours, breaks, time off, and station schedules.", back: "Dashboard",
    staffHours: "Team hours", stationHours: "Station hours", exceptions: "Breaks and time off",
    timeZone: "Salon time zone", open: "Open", start: "Start", end: "End", save: "Save",
    addException: "Add a break or time off", staff: "Team member", kind: "Type", break: "Break", timeOff: "Time off",
    from: "From", to: "To", note: "Note", add: "Add", remove: "Remove", empty: "No breaks or time off saved.",
    success: "Availability saved.", error: "The change failed. Review the schedule.", owner: "Only the owner changes availability.",
    noStations: "Add a station or chair to a service to configure its hours.",
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  },
  es: {
    title: "Disponibilidad", subtitle: "Configura horarios del equipo, descansos, ausencias y puestos.", back: "Panel",
    staffHours: "Horarios del equipo", stationHours: "Horarios de puestos", exceptions: "Descansos y ausencias",
    timeZone: "Zona horaria del salón", open: "Abierto", start: "Inicio", end: "Fin", save: "Guardar",
    addException: "Añadir descanso o ausencia", staff: "Miembro", kind: "Tipo", break: "Descanso", timeOff: "Ausencia",
    from: "Desde", to: "Hasta", note: "Nota", add: "Añadir", remove: "Eliminar", empty: "No hay descansos ni ausencias.",
    success: "Disponibilidad guardada.", error: "El cambio falló. Revisa el horario.", owner: "Solo el propietario modifica la disponibilidad.",
    noStations: "Añade un puesto o silla a un servicio para configurar su horario.",
    days: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"],
  },
} as const;

const inputClass = "h-10 rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5";
const cardClass = "rounded-[1.75rem] border border-[#e4d6c5] bg-white p-5 shadow-[0_12px_36px_rgba(48,32,18,0.06)] dark:border-white/10 dark:bg-[#17191e] sm:p-7";

function clock(value?: string) {
  return value?.slice(0, 5) ?? "09:00";
}

function WeeklyRows({
  locale,
  labels,
  kind,
  resourceId,
  rows,
}: {
  locale: "fr" | "en" | "es";
  labels: typeof copy.fr | typeof copy.en | typeof copy.es;
  kind: "staff" | "station";
  resourceId: string;
  rows: HourRow[];
}) {
  return (
    <div className="mt-4 divide-y divide-[#eadfD1] dark:divide-white/10">
      {labels.days.map((day, weekday) => {
        const row = rows.find((item) => item.weekday === weekday);
        const action = kind === "staff" ? saveStaffHours : saveStationHours;
        return (
          <form key={day} action={action.bind(null, locale)} className="grid gap-3 py-3 sm:grid-cols-[1.2fr_auto_1fr_1fr_auto] sm:items-end">
            <input type="hidden" name={kind === "staff" ? "staff_id" : "station_name"} value={resourceId} />
            <input type="hidden" name="weekday" value={weekday} />
            <strong className="text-sm">{day}</strong>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_enabled" defaultChecked={row?.is_enabled ?? (weekday > 0 && weekday < 6)} className="accent-[#a56d37]" />
              {labels.open}
            </label>
            <label className="text-xs text-slate-500">{labels.start}<input name="start_local" type="time" required defaultValue={clock(row?.start_local)} className={`${inputClass} mt-1 w-full`} /></label>
            <label className="text-xs text-slate-500">{labels.end}<input name="end_local" type="time" required defaultValue={row ? clock(row.end_local) : "17:00"} className={`${inputClass} mt-1 w-full`} /></label>
            <button type="submit" aria-label={`${labels.save} ${day}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white dark:bg-[#e8bb82] dark:text-slate-950"><Save className="size-4" />{labels.save}</button>
          </form>
        );
      })}
    </div>
  );
}

export default async function AvailabilityPage({
  params,
  searchParams,
}: {
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

  const [{ data: tenant }, { data: rawStaff }, { data: rawStaffHours }, { data: rawStationHours }, { data: rawExceptions }, { data: services }] = await Promise.all([
    supabase.from("tenants").select("time_zone").eq("id", owner.tenant_id).single(),
    supabase.from("users").select("id,full_name,role").eq("tenant_id", owner.tenant_id).order("full_name"),
    supabase.from("staff_working_hours").select("staff_id,weekday,start_local,end_local,is_enabled").eq("tenant_id", owner.tenant_id),
    supabase.from("station_working_hours").select("station_name,weekday,start_local,end_local,is_enabled").eq("tenant_id", owner.tenant_id),
    supabase.from("staff_schedule_exceptions").select("id,staff_id,kind,starts_at,ends_at,note").eq("tenant_id", owner.tenant_id).order("starts_at"),
    supabase.from("services").select("station_name").eq("tenant_id", owner.tenant_id).eq("is_active", true).not("station_name", "is", null),
  ]);

  const staff = rawStaff ?? [];
  const staffHours = (rawStaffHours ?? []) as HourRow[];
  const stationHours = (rawStationHours ?? []) as HourRow[];
  const exceptions = (rawExceptions ?? []) as ScheduleException[];
  const stations = Array.from(new Set([
    ...(services ?? []).map((service) => service.station_name).filter((name): name is string => Boolean(name)),
    ...stationHours.map((row) => row.station_name).filter((name): name is string => Boolean(name)),
  ])).sort();
  const staffName = new Map(staff.map((member) => [member.id, member.full_name]));
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: tenant?.time_zone ?? "UTC",
  });

  return (
    <main className="min-h-screen bg-[#faf9f6] px-4 py-8 text-slate-950 dark:bg-[#101216] dark:text-stone-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href={`/${locale}/dashboard`} className="inline-flex items-center gap-2 text-sm font-semibold text-[#9a602d] hover:underline dark:text-[#efc992]"><ArrowLeft className="size-4" />{labels.back}</Link>
        <div className="mt-4 flex items-start gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-[#f1dfc8] text-[#9a602d]"><CalendarClock className="size-6" /></span>
          <div><h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{labels.title}</h1><p className="mt-2 text-slate-600 dark:text-stone-300">{labels.subtitle}</p><p className="mt-1 text-sm font-medium text-[#9a602d]">{labels.timeZone}: {tenant?.time_zone ?? "UTC"}</p></div>
        </div>

        {query.saved ? <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{labels.success}</p> : null}
        {query.error ? <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{query.error === "owner_required" ? labels.owner : labels.error}</p> : null}

        <section className="mt-7">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><UserRound className="size-5 text-[#a56d37]" />{labels.staffHours}</h2>
          <div className="mt-4 grid gap-5">
            {staff.map((member) => <article key={member.id} className={cardClass}><h3 className="font-semibold">{member.full_name}</h3><WeeklyRows locale={locale} labels={labels} kind="staff" resourceId={member.id} rows={staffHours.filter((row) => row.staff_id === member.id)} /></article>)}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Warehouse className="size-5 text-[#a56d37]" />{labels.stationHours}</h2>
          {stations.length ? <div className="mt-4 grid gap-5">{stations.map((station) => <article key={station} className={cardClass}><h3 className="font-semibold">{station}</h3><WeeklyRows locale={locale} labels={labels} kind="station" resourceId={station} rows={stationHours.filter((row) => row.station_name === station)} /></article>)}</div> : <p className="mt-4 rounded-2xl border border-dashed border-[#d9c7b2] p-6 text-slate-500">{labels.noStations}</p>}
        </section>

        <section className={`${cardClass} mt-8`}>
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Coffee className="size-5 text-[#a56d37]" />{labels.addException}</h2>
          <form action={addScheduleException.bind(null, locale)} className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">{labels.staff}<select required name="staff_id" className={`${inputClass} mt-2 w-full`}>{staff.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label>
            <label className="text-sm font-medium">{labels.kind}<select name="kind" className={`${inputClass} mt-2 w-full`}><option value="break">{labels.break}</option><option value="time_off">{labels.timeOff}</option></select></label>
            <label className="text-sm font-medium">{labels.from}<input required name="local_start" type="datetime-local" className={`${inputClass} mt-2 w-full`} /></label>
            <label className="text-sm font-medium">{labels.to}<input required name="local_end" type="datetime-local" className={`${inputClass} mt-2 w-full`} /></label>
            <label className="text-sm font-medium sm:col-span-2">{labels.note}<input name="note" maxLength={240} className={`${inputClass} mt-2 w-full`} /></label>
            <button type="submit" className="inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white dark:bg-[#e8bb82] dark:text-slate-950">{labels.add}</button>
          </form>

          <h3 className="mt-8 font-semibold">{labels.exceptions}</h3>
          <div className="mt-3 grid gap-3">
            {exceptions.length ? exceptions.map((item) => <article key={item.id} className="flex flex-col gap-3 rounded-2xl border border-[#e4d6c5] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{staffName.get(item.staff_id)} · {item.kind === "break" ? labels.break : labels.timeOff}</p><p className="mt-1 text-sm text-slate-600 dark:text-stone-300">{formatter.format(new Date(item.starts_at))} – {formatter.format(new Date(item.ends_at))}</p>{item.note ? <p className="mt-1 text-sm">{item.note}</p> : null}</div><form action={deleteScheduleException.bind(null, locale)}><input type="hidden" name="exception_id" value={item.id} /><button type="submit" className="inline-flex h-10 items-center gap-2 rounded-full border border-rose-200 px-4 text-sm font-semibold text-rose-700"><Trash2 className="size-4" />{labels.remove}</button></form></article>) : <p className="text-sm text-slate-500">{labels.empty}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

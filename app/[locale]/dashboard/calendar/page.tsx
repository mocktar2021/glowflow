import { randomUUID } from "node:crypto";

import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  UserPlus,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/markets";
import { CalendarDateTimeFields } from "./date-time-fields";
import {
  cancelAppointment,
  createAppointment,
  createQuickClient,
  rescheduleAppointment,
} from "./actions";

export const dynamic = "force-dynamic";

type CalendarView = "day" | "week";
type Appointment = {
  id: string;
  client_id: string;
  service_id: string;
  staff_id: string;
  start_time: string;
  end_time: string;
  status: "confirmed" | "completed" | "canceled" | "no_show";
  deposit_paid: boolean;
  station_name: string | null;
};
type Client = { id: string; full_name: string };
type Service = {
  id: string;
  title_json: Record<string, string>;
  price: number;
  deposit_amount: number;
  currency: string;
  station_name: string | null;
};
type Staff = { id: string; full_name: string };

const copy = {
  fr: {
    title: "Calendrier", subtitle: "Gérez les rendez-vous de l’équipe en vue quotidienne ou hebdomadaire.", back: "Tableau de bord",
    day: "Jour", week: "Semaine", today: "Aujourd’hui", previous: "Précédent", next: "Suivant", timeZone: "Fuseau horaire",
    newAppointment: "Nouveau rendez-vous", client: "Client", service: "Prestation", staff: "Membre", start: "Date et heure", date: "Date", time: "Heure", selectDate: "Choisir cette date", create: "Créer",
    quickClient: "Ajouter rapidement un client", fullName: "Nom complet", phone: "Téléphone", email: "E-mail", addClient: "Ajouter le client",
    noClients: "Ajoutez un client avant de créer un rendez-vous.", noServices: "Ajoutez une prestation active avant de créer un rendez-vous.",
    empty: "Aucun rendez-vous pour cette période.", confirmed: "Confirmé", completed: "Terminé", canceled: "Annulé", no_show: "Absent",
    paid: "Acompte payé", unpaid: "Acompte non payé", reschedule: "Reprogrammer", cancel: "Annuler",
    saved: "Modification enregistrée.", conflict: "Ce créneau n’est pas disponible. Vérifiez les horaires, les pauses et les conflits.",
    error: "La modification a échoué. Vérifiez les informations.", member: "Accès réservé à l’équipe du salon.",
  },
  en: {
    title: "Calendar", subtitle: "Manage team appointments in daily or weekly view.", back: "Dashboard",
    day: "Day", week: "Week", today: "Today", previous: "Previous", next: "Next", timeZone: "Time zone",
    newAppointment: "New appointment", client: "Client", service: "Service", staff: "Team member", start: "Date and time", date: "Date", time: "Time", selectDate: "Select this date", create: "Create",
    quickClient: "Quick add client", fullName: "Full name", phone: "Phone", email: "Email", addClient: "Add client",
    noClients: "Add a client before creating an appointment.", noServices: "Add an active service before creating an appointment.",
    empty: "No appointments in this period.", confirmed: "Confirmed", completed: "Completed", canceled: "Canceled", no_show: "No-show",
    paid: "Deposit paid", unpaid: "Deposit unpaid", reschedule: "Reschedule", cancel: "Cancel",
    saved: "Change saved.", conflict: "This time is unavailable. Review working hours, breaks, and conflicts.",
    error: "The change failed. Review the information.", member: "Salon team access is required.",
  },
  es: {
    title: "Calendario", subtitle: "Gestiona las citas del equipo en vista diaria o semanal.", back: "Panel",
    day: "Día", week: "Semana", today: "Hoy", previous: "Anterior", next: "Siguiente", timeZone: "Zona horaria",
    newAppointment: "Nueva cita", client: "Cliente", service: "Servicio", staff: "Miembro", start: "Fecha y hora", date: "Fecha", time: "Hora", selectDate: "Elegir esta fecha", create: "Crear",
    quickClient: "Añadir cliente rápido", fullName: "Nombre completo", phone: "Teléfono", email: "Correo", addClient: "Añadir cliente",
    noClients: "Añade un cliente antes de crear una cita.", noServices: "Añade un servicio activo antes de crear una cita.",
    empty: "No hay citas en este período.", confirmed: "Confirmada", completed: "Completada", canceled: "Cancelada", no_show: "Ausente",
    paid: "Depósito pagado", unpaid: "Depósito pendiente", reschedule: "Reprogramar", cancel: "Cancelar",
    saved: "Cambio guardado.", conflict: "Este horario no está disponible. Revisa horarios, descansos y conflictos.",
    error: "El cambio falló. Revisa la información.", member: "Se requiere acceso del equipo del salón.",
  },
} as const;

const inputClass = "mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5";
const cardClass = "rounded-[1.75rem] border border-[#e4d6c5] bg-white p-5 shadow-[0_12px_36px_rgba(48,32,18,0.06)] dark:border-white/10 dark:bg-[#17191e] sm:p-7";

function validDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekStart(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const offset = (value.getUTCDay() + 6) % 7;
  return shiftDate(date, -offset);
}

function dateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function localDateTimeValue(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string; view?: string; saved?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const labels = copy[locale];
  const query = await searchParams;
  const view: CalendarView = query.view === "week" ? "week" : "day";

  const { supabase, userId } = await requireUser(locale);
  const { data: member } = await supabase.from("users").select("tenant_id,role").eq("id", userId).single();
  if (!member?.tenant_id || !["owner", "staff"].includes(member.role)) notFound();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("time_zone,currency")
    .eq("id", member.tenant_id)
    .single();
  if (!tenant) notFound();

  const today = dateKey(new Date(), tenant.time_zone);
  const selected = validDate(query.date) ?? today;
  const firstDay = view === "week" ? weekStart(selected) : selected;
  const days = Array.from({ length: view === "week" ? 7 : 1 }, (_, index) => shiftDate(firstDay, index));
  const rangeStart = new Date(`${shiftDate(firstDay, -1)}T00:00:00Z`).toISOString();
  const rangeEnd = new Date(`${shiftDate(firstDay, days.length + 1)}T00:00:00Z`).toISOString();

  const [
    { data: rawAppointments },
    { data: rawClients },
    { data: rawServices },
    { data: rawStaff },
  ] = await Promise.all([
    supabase.from("appointments")
      .select("id,client_id,service_id,staff_id,start_time,end_time,status,deposit_paid,station_name")
      .eq("tenant_id", member.tenant_id)
      .gte("start_time", rangeStart)
      .lt("start_time", rangeEnd)
      .order("start_time"),
    supabase.from("clients").select("id,full_name").eq("tenant_id", member.tenant_id).order("full_name"),
    supabase.from("services")
      .select("id,title_json,price,deposit_amount,currency,station_name")
      .eq("tenant_id", member.tenant_id).eq("is_active", true).order("created_at"),
    supabase.from("users").select("id,full_name").eq("tenant_id", member.tenant_id).order("full_name"),
  ]);

  const appointments = (rawAppointments ?? []) as Appointment[];
  const clients = (rawClients ?? []) as Client[];
  const services = (rawServices ?? []) as Service[];
  const staff = (rawStaff ?? []) as Staff[];
  const clientName = new Map(clients.map((item) => [item.id, item.full_name]));
  const serviceById = new Map(services.map((item) => [item.id, item]));
  const staffName = new Map(staff.map((item) => [item.id, item.full_name]));
  const visibleAppointments = appointments.filter((item) => days.includes(dateKey(new Date(item.start_time), tenant.time_zone)));
  const previousDate = shiftDate(firstDay, view === "week" ? -7 : -1);
  const nextDate = shiftDate(firstDay, view === "week" ? 7 : 1);
  const queryBase = `date=${selected}&view=${view}`;
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: tenant.time_zone, hour: "2-digit", minute: "2-digit",
  });
  const dayFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC", weekday: "long", month: "short", day: "numeric",
  });
  const errorMessage = query.error === "conflict" ? labels.conflict : query.error === "member_required" ? labels.member : labels.error;

  return (
    <main className="min-h-screen bg-[#faf9f6] px-4 py-8 text-slate-950 dark:bg-[#101216] dark:text-stone-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <Link href={`/${locale}/dashboard`} className="inline-flex items-center gap-2 text-sm font-semibold text-[#9a602d] hover:underline dark:text-[#efc992]">
          <ArrowLeft className="size-4" />{labels.back}
        </Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-[#f1dfc8] text-[#9a602d]"><CalendarDays className="size-6" /></span>
            <div><h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{labels.title}</h1><p className="mt-2 text-slate-600 dark:text-stone-300">{labels.subtitle}</p><p className="mt-1 text-sm font-medium text-[#9a602d]">{labels.timeZone}: {tenant.time_zone}</p></div>
          </div>
          <div className="flex rounded-full border border-[#dfd2c1] bg-white p-1 dark:border-white/15 dark:bg-white/5">
            {(["day", "week"] as const).map((option) => <Link key={option} href={`/${locale}/dashboard/calendar?date=${selected}&view=${option}`} className={`rounded-full px-5 py-2 text-sm font-semibold ${view === option ? "bg-slate-950 text-white dark:bg-[#e8bb82] dark:text-slate-950" : ""}`}>{labels[option]}</Link>)}
          </div>
        </div>

        {query.saved ? <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{labels.saved}</p> : null}
        {query.error ? <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{errorMessage}</p> : null}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link aria-label={labels.previous} href={`/${locale}/dashboard/calendar?date=${previousDate}&view=${view}`} className="grid size-11 place-items-center rounded-full border border-[#dfd2c1] bg-white dark:border-white/15 dark:bg-white/5"><ChevronLeft className="size-5" /></Link>
          <Link href={`/${locale}/dashboard/calendar?date=${today}&view=${view}`} className="h-11 rounded-full border border-[#dfd2c1] bg-white px-5 py-3 text-sm font-semibold dark:border-white/15 dark:bg-white/5">{labels.today}</Link>
          <Link aria-label={labels.next} href={`/${locale}/dashboard/calendar?date=${nextDate}&view=${view}`} className="grid size-11 place-items-center rounded-full border border-[#dfd2c1] bg-white dark:border-white/15 dark:bg-white/5"><ChevronRight className="size-5" /></Link>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className={view === "week" ? "grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2" : "grid gap-4"}>
            {days.map((day) => {
              const dayAppointments = visibleAppointments.filter((item) => dateKey(new Date(item.start_time), tenant.time_zone) === day);
              return <article key={day} className={cardClass}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="capitalize text-lg font-semibold">{dayFormatter.format(new Date(`${day}T12:00:00Z`))}</h2>
                  <Link href={`/${locale}/dashboard/calendar?date=${day}&view=day`} className="rounded-full border border-[#d9c7b2] px-3 py-2 text-xs font-semibold text-[#8b572a]">
                    {labels.selectDate}
                  </Link>
                </div>
                <div className="mt-4 grid gap-3">
                  {dayAppointments.length ? dayAppointments.map((appointment) => {
                    const service = serviceById.get(appointment.service_id);
                    return <div key={appointment.id} className="rounded-2xl border border-[#eadfce] bg-[#fffdf9] p-4 dark:border-white/10 dark:bg-white/5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold">{formatter.format(new Date(appointment.start_time))} · {clientName.get(appointment.client_id) ?? labels.client}</p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-stone-300">{service?.title_json[locale] ?? service?.title_json.fr} · {staffName.get(appointment.staff_id)}</p>
                          <p className="mt-1 text-xs text-slate-500">{appointment.station_name ?? ""} {service ? `· ${formatMoney(service.price, service.currency, locale)}` : ""}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${appointment.status === "confirmed" ? "bg-emerald-100 text-emerald-800" : appointment.status === "canceled" ? "bg-rose-100 text-rose-800" : "bg-stone-100 text-stone-700"}`}>{labels[appointment.status]}</span>
                          <span className="text-xs font-medium text-slate-500">{appointment.deposit_paid ? labels.paid : labels.unpaid}</span>
                        </div>
                      </div>
                      {appointment.status === "confirmed" ? <div className="mt-4 grid gap-3 border-t border-[#eadfce] pt-4 sm:grid-cols-[1fr_auto] dark:border-white/10">
                        <form action={rescheduleAppointment.bind(null, locale)} className="flex flex-col gap-2 sm:flex-row">
                          <input type="hidden" name="appointment_id" value={appointment.id} /><input type="hidden" name="calendar_date" value={selected} /><input type="hidden" name="calendar_view" value={view} />
                          <CalendarDateTimeFields
                            initialDate={localDateTimeValue(new Date(appointment.start_time), tenant.time_zone).slice(0, 10)}
                            initialTime={localDateTimeValue(new Date(appointment.start_time), tenant.time_zone).slice(11, 16)}
                            dateLabel={labels.date}
                            timeLabel={labels.time}
                          />
                          <button type="submit" className="h-11 rounded-full border border-[#c99a66] px-4 text-sm font-semibold text-[#8b572a]">{labels.reschedule}</button>
                        </form>
                        <form action={cancelAppointment.bind(null, locale)}>
                          <input type="hidden" name="appointment_id" value={appointment.id} /><input type="hidden" name="calendar_date" value={selected} /><input type="hidden" name="calendar_view" value={view} />
                          <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-full border border-rose-200 px-4 text-sm font-semibold text-rose-700"><XCircle className="size-4" />{labels.cancel}</button>
                        </form>
                      </div> : null}
                    </div>;
                  }) : <p className="rounded-2xl border border-dashed border-[#d9c7b2] p-5 text-sm text-slate-500">{labels.empty}</p>}
                </div>
              </article>;
            })}
          </section>

          <aside className="grid content-start gap-5">
            <section className={cardClass}>
              <h2 className="flex items-center gap-2 text-xl font-semibold"><Plus className="size-5 text-[#a56d37]" />{labels.newAppointment}</h2>
              {!clients.length ? <p className="mt-4 text-sm text-amber-700">{labels.noClients}</p> : null}
              {!services.length ? <p className="mt-4 text-sm text-amber-700">{labels.noServices}</p> : null}
              <form action={createAppointment.bind(null, locale)} className="mt-5 grid gap-4">
                <input type="hidden" name="request_key" value={randomUUID()} /><input type="hidden" name="calendar_date" value={selected} /><input type="hidden" name="calendar_view" value={view} />
                <label className="text-sm font-medium">{labels.client}<select required name="client_id" className={inputClass}>{clients.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
                <label className="text-sm font-medium">{labels.service}<select required name="service_id" className={inputClass}>{services.map((item) => <option key={item.id} value={item.id}>{item.title_json[locale] ?? item.title_json.fr}</option>)}</select></label>
                <label className="text-sm font-medium">{labels.staff}<select required name="staff_id" className={inputClass}>{staff.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
                <CalendarDateTimeFields initialDate={selected} initialTime="09:00" dateLabel={labels.date} timeLabel={labels.time} />
                <button disabled={!clients.length || !services.length || !staff.length} type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#e8bb82] dark:text-slate-950"><Plus className="size-4" />{labels.create}</button>
              </form>
            </section>

            <section className={cardClass}>
              <h2 className="flex items-center gap-2 text-lg font-semibold"><UserPlus className="size-5 text-[#a56d37]" />{labels.quickClient}</h2>
              <form action={createQuickClient.bind(null, locale)} className="mt-4 grid gap-3">
                <input type="hidden" name="calendar_date" value={selected} /><input type="hidden" name="calendar_view" value={view} />
                <label className="text-sm font-medium">{labels.fullName}<input required name="full_name" maxLength={120} className={inputClass} /></label>
                <label className="text-sm font-medium">{labels.phone}<input name="phone" type="tel" maxLength={40} className={inputClass} /></label>
                <label className="text-sm font-medium">{labels.email}<input name="email" type="email" maxLength={160} className={inputClass} /></label>
                <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#c99a66] px-4 text-sm font-semibold text-[#8b572a]"><UserPlus className="size-4" />{labels.addClient}</button>
              </form>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

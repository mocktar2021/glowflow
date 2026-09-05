import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Clock3,
  Play,
  Plus,
  Trash2,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import {
  addWalkIn,
  assignWalkIn,
  moveWalkIn,
  setWalkInStatus,
} from "./actions";
import { WalkInRealtime } from "./realtime";

export const dynamic = "force-dynamic";

type QueueStatus = "waiting" | "ready" | "in_service" | "completed" | "removed";
type QueueEntry = {
  id: string;
  client_name: string;
  service_id: string;
  staff_id: string | null;
  station_name: string | null;
  status: QueueStatus;
  position: number;
  estimated_wait_minutes: number;
  arrived_at: string;
  started_at: string | null;
  completed_at: string | null;
};
type Service = {
  id: string;
  title_json: Record<string, string>;
  duration_minutes: number;
  station_name: string | null;
};
type Staff = { id: string; full_name: string };

const copy = {
  fr: {
    title: "File sans rendez-vous",
    subtitle: "Gérez les arrivées, l’attente, les affectations et le service en direct.",
    back: "Tableau de bord",
    add: "Ajouter une personne",
    clientName: "Nom du client",
    service: "Prestation",
    staff: "Membre",
    unassigned: "Non affecté",
    station: "Poste ou fauteuil",
    wait: "Attente estimée",
    minutes: "minutes",
    enqueue: "Ajouter à la file",
    active: "File active",
    activeMeta: "Les changements apparaissent automatiquement sur les appareils connectés.",
    empty: "Aucune personne dans la file.",
    arrived: "Arrivée",
    waiting: "En attente",
    ready: "Prêt",
    in_service: "En service",
    completed: "Terminé",
    removed: "Retiré",
    assign: "Enregistrer l’affectation",
    markReady: "Prêt",
    start: "Démarrer",
    complete: "Terminer",
    remove: "Retirer",
    moveUp: "Monter",
    moveDown: "Descendre",
    history: "Terminés aujourd’hui",
    noHistory: "Aucun service terminé aujourd’hui.",
    saved: "File mise à jour.",
    error: "La modification a échoué. Vérifiez les informations.",
    member: "Accès réservé à l’équipe du salon.",
  },
  en: {
    title: "Walk-in queue",
    subtitle: "Manage arrivals, wait times, assignments, and service status live.",
    back: "Dashboard",
    add: "Add walk-in",
    clientName: "Client name",
    service: "Service",
    staff: "Team member",
    unassigned: "Unassigned",
    station: "Station or chair",
    wait: "Estimated wait",
    minutes: "minutes",
    enqueue: "Add to queue",
    active: "Active queue",
    activeMeta: "Changes appear automatically on connected salon devices.",
    empty: "No clients are waiting.",
    arrived: "Arrived",
    waiting: "Waiting",
    ready: "Ready",
    in_service: "In service",
    completed: "Completed",
    removed: "Removed",
    assign: "Save assignment",
    markReady: "Ready",
    start: "Start",
    complete: "Complete",
    remove: "Remove",
    moveUp: "Move up",
    moveDown: "Move down",
    history: "Completed today",
    noHistory: "No completed services today.",
    saved: "Queue updated.",
    error: "The change failed. Review the information.",
    member: "Salon team access is required.",
  },
  es: {
    title: "Cola sin cita",
    subtitle: "Gestiona llegadas, espera, asignaciones y estado del servicio en directo.",
    back: "Panel",
    add: "Añadir cliente",
    clientName: "Nombre del cliente",
    service: "Servicio",
    staff: "Miembro del equipo",
    unassigned: "Sin asignar",
    station: "Puesto o silla",
    wait: "Espera estimada",
    minutes: "minutos",
    enqueue: "Añadir a la cola",
    active: "Cola activa",
    activeMeta: "Los cambios aparecen automáticamente en los dispositivos conectados.",
    empty: "No hay clientes esperando.",
    arrived: "Llegada",
    waiting: "En espera",
    ready: "Listo",
    in_service: "En servicio",
    completed: "Completado",
    removed: "Retirado",
    assign: "Guardar asignación",
    markReady: "Listo",
    start: "Iniciar",
    complete: "Completar",
    remove: "Retirar",
    moveUp: "Subir",
    moveDown: "Bajar",
    history: "Completados hoy",
    noHistory: "No hay servicios completados hoy.",
    saved: "Cola actualizada.",
    error: "El cambio falló. Revisa la información.",
    member: "Se requiere acceso del equipo del salón.",
  },
} as const;

const card = "rounded-[1.75rem] border border-[#e4d6c5] bg-white p-5 shadow-[0_12px_36px_rgba(48,32,18,0.06)] dark:border-white/10 dark:bg-[#17191e] sm:p-7";
const input = "mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5";

function statusClass(status: QueueStatus) {
  if (status === "ready") return "bg-emerald-100 text-emerald-800";
  if (status === "in_service") return "bg-amber-100 text-amber-800";
  if (status === "completed") return "bg-slate-100 text-slate-700";
  return "bg-stone-100 text-stone-700";
}

export default async function WalkInsPage({
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
  const { data: member } = await supabase
    .from("users")
    .select("tenant_id,role")
    .eq("id", userId)
    .single();

  if (!member?.tenant_id || !["owner", "staff"].includes(member.role)) notFound();

  const [{ data: rawQueue }, { data: rawServices }, { data: rawStaff }, { data: tenant }] =
    await Promise.all([
      supabase
        .from("walk_in_queue")
        .select("id,client_name,service_id,staff_id,station_name,status,position,estimated_wait_minutes,arrived_at,started_at,completed_at")
        .eq("tenant_id", member.tenant_id)
        .order("position")
        .order("arrived_at", { ascending: false }),
      supabase
        .from("services")
        .select("id,title_json,duration_minutes,station_name")
        .eq("tenant_id", member.tenant_id)
        .eq("is_active", true)
        .order("created_at"),
      supabase
        .from("users")
        .select("id,full_name")
        .eq("tenant_id", member.tenant_id)
        .order("full_name"),
      supabase
        .from("tenants")
        .select("time_zone")
        .eq("id", member.tenant_id)
        .single(),
    ]);

  if (!tenant) notFound();

  const queue = (rawQueue ?? []) as QueueEntry[];
  const services = (rawServices ?? []) as Service[];
  const staff = (rawStaff ?? []) as Staff[];
  const active = queue
    .filter((entry) => ["waiting", "ready", "in_service"].includes(entry.status))
    .sort((a, b) => a.position - b.position);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: tenant.time_zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const history = queue
    .filter(
      (entry) =>
        entry.status === "completed" &&
        new Intl.DateTimeFormat("en-CA", {
          timeZone: tenant.time_zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(entry.completed_at ?? entry.arrived_at)) === today,
    )
    .slice(0, 20);
  const serviceById = new Map(services.map((item) => [item.id, item]));
  const staffById = new Map(staff.map((item) => [item.id, item.full_name]));
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: tenant.time_zone,
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <main className="min-h-screen bg-[#faf9f6] px-4 py-8 text-slate-950 dark:bg-[#101216] dark:text-stone-100 sm:px-6 lg:px-8">
      <WalkInRealtime tenantId={member.tenant_id} />
      <div className="mx-auto max-w-7xl">
        <Link href={`/${locale}/dashboard`} className="inline-flex items-center gap-2 text-sm font-semibold text-[#9a602d] hover:underline dark:text-[#efc992]">
          <ArrowLeft className="size-4" />{labels.back}
        </Link>

        <div className="mt-4 flex items-start gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-[#f1dfc8] text-[#9a602d]">
            <UsersRound className="size-6" />
          </span>
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{labels.title}</h1>
            <p className="mt-2 text-slate-600 dark:text-stone-300">{labels.subtitle}</p>
          </div>
        </div>

        {query.saved ? <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{labels.saved}</p> : null}
        {query.error ? <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{query.error === "member_required" ? labels.member : labels.error}</p> : null}

        <div className="mt-7 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className={card}>
            <h2 className="flex items-center gap-2 text-xl font-semibold"><Plus className="size-5 text-[#a56d37]" />{labels.add}</h2>
            <form action={addWalkIn.bind(null, locale)} className="mt-5 grid gap-4">
              <label className="text-sm font-medium">{labels.clientName}<input required name="client_name" minLength={2} maxLength={120} className={input} /></label>
              <label className="text-sm font-medium">{labels.service}<select required name="service_id" className={input}>{services.map((item) => <option key={item.id} value={item.id}>{item.title_json[locale] ?? item.title_json.fr}</option>)}</select></label>
              <label className="text-sm font-medium">{labels.staff}<select name="staff_id" className={input}><option value="">{labels.unassigned}</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
              <label className="text-sm font-medium">{labels.station}<input name="station_name" maxLength={80} className={input} /></label>
              <label className="text-sm font-medium">{labels.wait} ({labels.minutes})<input required name="estimated_wait_minutes" type="number" min={0} max={720} defaultValue={0} className={input} /></label>
              <button disabled={!services.length} type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-[#e8bb82] dark:text-slate-950"><Plus className="size-4" />{labels.enqueue}</button>
            </form>
          </section>

          <div className="grid content-start gap-6">
            <section className={card}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><h2 className="text-xl font-semibold">{labels.active}</h2><p className="mt-1 text-sm text-slate-500 dark:text-stone-400">{labels.activeMeta}</p></div>
                <span className="rounded-full bg-[#f1dfc8] px-3 py-1 text-sm font-semibold text-[#8b572a]">{active.length}</span>
              </div>
              <div className="mt-5 grid gap-4">
                {active.length ? active.map((entry, index) => {
                  const service = serviceById.get(entry.service_id);
                  return (
                    <article key={entry.id} className="rounded-2xl border border-[#eadfce] bg-[#fffdf9] p-4 dark:border-white/10 dark:bg-white/5">
                      <div className="flex flex-wrap items-start gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-950 text-sm font-bold text-white dark:bg-[#e8bb82] dark:text-slate-950">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{entry.client_name}</h3>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(entry.status)}`}>{labels[entry.status]}</span>
                          </div>
                          <p className="mt-1 text-sm text-slate-600 dark:text-stone-300">{service?.title_json[locale] ?? service?.title_json.fr} · {service?.duration_minutes} {labels.minutes}</p>
                          <p className="mt-1 text-xs text-slate-500">{labels.arrived}: {time.format(new Date(entry.arrived_at))} · {entry.estimated_wait_minutes} {labels.minutes}</p>
                        </div>
                        <div className="flex gap-1">
                          <form action={moveWalkIn.bind(null, locale)}><input type="hidden" name="walk_in_id" value={entry.id} /><input type="hidden" name="direction" value="-1" /><button disabled={index === 0 || entry.status === "in_service"} aria-label={labels.moveUp} className="grid size-10 place-items-center rounded-full border border-[#dfd2c1] disabled:opacity-30"><ArrowUp className="size-4" /></button></form>
                          <form action={moveWalkIn.bind(null, locale)}><input type="hidden" name="walk_in_id" value={entry.id} /><input type="hidden" name="direction" value="1" /><button disabled={index === active.length - 1 || entry.status === "in_service"} aria-label={labels.moveDown} className="grid size-10 place-items-center rounded-full border border-[#dfd2c1] disabled:opacity-30"><ArrowDown className="size-4" /></button></form>
                        </div>
                      </div>

                      {entry.status !== "in_service" ? (
                        <form action={assignWalkIn.bind(null, locale)} className="mt-4 grid gap-3 border-t border-[#eadfce] pt-4 sm:grid-cols-3">
                          <input type="hidden" name="walk_in_id" value={entry.id} />
                          <label className="text-xs font-medium">{labels.staff}<select name="staff_id" defaultValue={entry.staff_id ?? ""} className={input}><option value="">{labels.unassigned}</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
                          <label className="text-xs font-medium">{labels.station}<input name="station_name" defaultValue={entry.station_name ?? service?.station_name ?? ""} maxLength={80} className={input} /></label>
                          <label className="text-xs font-medium">{labels.wait}<input name="estimated_wait_minutes" type="number" min={0} max={720} defaultValue={entry.estimated_wait_minutes} className={input} /></label>
                          <button className="h-10 rounded-full border border-[#c99a66] px-4 text-sm font-semibold text-[#8b572a] sm:col-span-3">{labels.assign}</button>
                        </form>
                      ) : (
                        <p className="mt-4 border-t border-[#eadfce] pt-4 text-sm text-slate-600">{staffById.get(entry.staff_id ?? "") ?? labels.unassigned} · {entry.station_name ?? labels.unassigned}</p>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">
                        {entry.status === "waiting" ? <StatusButton locale={locale} id={entry.id} status="ready" label={labels.markReady} icon="ready" /> : null}
                        {entry.status === "ready" ? <StatusButton locale={locale} id={entry.id} status="waiting" label={labels.waiting} icon="wait" /> : null}
                        {entry.status === "waiting" || entry.status === "ready" ? <StatusButton locale={locale} id={entry.id} status="in_service" label={labels.start} icon="start" /> : null}
                        {entry.status === "in_service" ? <StatusButton locale={locale} id={entry.id} status="completed" label={labels.complete} icon="complete" /> : null}
                        <StatusButton locale={locale} id={entry.id} status="removed" label={labels.remove} icon="remove" />
                      </div>
                    </article>
                  );
                }) : <p className="rounded-2xl border border-dashed border-[#d9c7b2] p-6 text-sm text-slate-500">{labels.empty}</p>}
              </div>
            </section>

            <section className={card}>
              <h2 className="text-xl font-semibold">{labels.history}</h2>
              <div className="mt-4 grid gap-2">
                {history.length ? history.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f7f2eb] px-4 py-3 dark:bg-white/5"><span><strong className="block text-sm">{entry.client_name}</strong><span className="text-xs text-slate-500">{serviceById.get(entry.service_id)?.title_json[locale] ?? serviceById.get(entry.service_id)?.title_json.fr}</span></span><span className="text-sm font-medium">{time.format(new Date(entry.completed_at ?? entry.arrived_at))}</span></div>) : <p className="text-sm text-slate-500">{labels.noHistory}</p>}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function StatusButton({
  locale,
  id,
  status,
  label,
  icon,
}: {
  locale: "fr" | "en" | "es";
  id: string;
  status: QueueStatus;
  label: string;
  icon: "ready" | "wait" | "start" | "complete" | "remove";
}) {
  const Icon = icon === "start" ? Play : icon === "complete" || icon === "ready" ? CheckCircle2 : icon === "remove" ? Trash2 : Clock3;
  return (
    <form action={setWalkInStatus.bind(null, locale)}>
      <input type="hidden" name="walk_in_id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold ${icon === "remove" ? "border border-rose-200 text-rose-700" : "bg-slate-950 text-white dark:bg-[#e8bb82] dark:text-slate-950"}`}>
        <Icon className="size-4" />{label}
      </button>
    </form>
  );
}

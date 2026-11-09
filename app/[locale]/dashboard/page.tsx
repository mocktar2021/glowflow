import {
  Bell,
  CalendarClock,
  CalendarDays,
  CreditCard,
  Globe,
  MailPlus,
  Package,
  Scissors,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceShell } from "@/components/glowflow/workspace-shell";
import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { staffInvitationManagementEnabled } from "@/lib/staff-invitations";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const copy = {
  fr: {
    greeting: "Bonjour", eyebrow: "Aujourd’hui dans votre salon", subtitle: "Votre espace de travail pour gérer le salon.",
    signOut: "Se déconnecter", navigation: "Gestion du salon", today: "Aujourd’hui", openCalendar: "Ouvrir le calendrier",
    workTitle: "Une journée plus claire commence ici.", workBody: "Retrouvez vos rendez-vous, vos clients et les outils de votre équipe au même endroit.",
    nextTitle: "Votre journée, à votre rythme", nextBody: "Consultez l’agenda pour voir les rendez-vous et les disponibilités réels de votre équipe.",
    quickTitle: "Accès rapide", quickBody: "Ouvrez les outils que vous utilisez le plus souvent.",
    calendar: "Calendrier", walkIns: "Sans rendez-vous", clients: "Clients", services: "Prestations", products: "Produits",
    availability: "Équipe et disponibilités", invitations: "Inviter l’équipe", profile: "Profil public", payments: "Paiements", notifications: "Historique des notifications",
  },
  en: {
    greeting: "Good day", eyebrow: "Today at your salon", subtitle: "Your workspace for running the salon.",
    signOut: "Sign out", navigation: "Salon management", today: "Today", openCalendar: "Open calendar",
    workTitle: "A clearer day starts here.", workBody: "Keep appointments, clients, and team tools together in one calm workspace.",
    nextTitle: "Your day, at your pace", nextBody: "Open the calendar for your team’s real appointments and availability.",
    quickTitle: "Quick access", quickBody: "Open the tools you use most often.",
    calendar: "Calendar", walkIns: "Walk-ins", clients: "Clients", services: "Service catalog", products: "Products",
    availability: "Team and availability", invitations: "Invite team", profile: "Public profile", payments: "Payments", notifications: "Notification history",
  },
  es: {
    greeting: "Buen día", eyebrow: "Hoy en tu salón", subtitle: "Tu espacio de trabajo para gestionar el salón.",
    signOut: "Cerrar sesión", navigation: "Gestión del salón", today: "Hoy", openCalendar: "Abrir calendario",
    workTitle: "Un día más claro empieza aquí.", workBody: "Reúne citas, clientes y herramientas del equipo en un espacio tranquilo.",
    nextTitle: "Tu día, a tu ritmo", nextBody: "Abre el calendario para ver las citas y la disponibilidad reales de tu equipo.",
    quickTitle: "Acceso rápido", quickBody: "Abre las herramientas que usas con más frecuencia.",
    calendar: "Calendario", walkIns: "Sin cita", clients: "Clientes", services: "Servicios", products: "Productos",
    availability: "Equipo y disponibilidad", invitations: "Invitar al equipo", profile: "Perfil público", payments: "Pagos", notifications: "Historial de notificaciones",
  },
} as const;

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const { supabase, userId } = await requireUser(locale);
  const { data: profile } = await supabase.from("users").select("full_name, tenant_id").eq("id", userId).single();
  const { data: tenant } = profile?.tenant_id
    ? await supabase.from("tenants").select("name, owner_id, currency, country_code, time_zone").eq("id", profile.tenant_id).single()
    : { data: null };
  if (!profile || !tenant) throw new Error("Authenticated salon workspace is missing");

  const labels = copy[locale];
  const owner = tenant.owner_id === userId;
  const links = [
    { route: "calendar", title: labels.calendar, icon: CalendarDays },
    { route: "walk-ins", title: labels.walkIns, icon: UsersRound },
    { route: "clients", title: labels.clients, icon: UsersRound },
    { route: "notifications", title: labels.notifications, icon: Bell },
    ...(owner ? [
      { route: "services", title: labels.services, icon: Scissors },
      { route: "products", title: labels.products, icon: Package },
      { route: "availability", title: labels.availability, icon: CalendarClock },
      ...(staffInvitationManagementEnabled() ? [{ route: "team/invitations", title: labels.invitations, icon: MailPlus }] : []),
      { route: "public-profile", title: labels.profile, icon: Globe },
      { route: "payments", title: labels.payments, icon: CreditCard },
    ] : []),
  ];
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: tenant.time_zone }).format(new Date());
  const firstName = profile.full_name?.trim().split(/\s+/)[0] || tenant.name;
  const quickLinks = links.filter(({ route }) => ["calendar", "clients", "walk-ins", "public-profile"].includes(route));

  return (
    <WorkspaceShell locale={locale} active="today">
      <main className="mx-auto max-w-7xl px-5 pb-28 pt-10 sm:px-8 sm:pt-14 lg:pb-16">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne-deep dark:text-[#d9b48f]">{labels.eyebrow}</p>
          <h1 className="mt-4 font-display text-5xl font-medium leading-tight sm:text-6xl">{labels.greeting}, <em className="font-normal text-primary">{firstName}</em></h1>
          <p className="mt-2 text-sm text-muted-foreground">{date} · {tenant.time_zone}</p>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">{labels.subtitle}</p>

          <div className="mt-10 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
            <section className="rounded-[1.75rem] border border-border bg-card p-7 shadow-sm sm:p-9" aria-labelledby="today-title">
              <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground"><CalendarDays className="size-5" strokeWidth={1.6} aria-hidden="true" /></span>
              <h2 id="today-title" className="mt-6 max-w-xl font-display text-4xl font-medium leading-tight sm:text-5xl">{labels.workTitle}</h2>
              <p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">{labels.workBody}</p>
              <div className="mt-9 border-t border-border pt-6"><h3 className="font-display text-3xl">{labels.nextTitle}</h3><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{labels.nextBody}</p><Link href={`/${locale}/dashboard/calendar`} className="mt-5 inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">{labels.openCalendar}</Link></div>
            </section>
            <section className="rounded-[1.75rem] border border-border bg-muted p-7 sm:p-9" aria-labelledby="quick-title"><h2 id="quick-title" className="font-display text-4xl font-medium">{labels.quickTitle}</h2><p className="mt-3 text-sm text-muted-foreground">{labels.quickBody}</p><div className="mt-7 grid gap-3">{quickLinks.map(({ route, title, icon: Icon }) => <Link key={route} href={`/${locale}/dashboard/${route}`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-card px-4 text-sm font-semibold transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary"><Icon className="size-5 text-primary" strokeWidth={1.6} aria-hidden="true" />{title}</Link>)}</div></section>
          </div>
      </main>
    </WorkspaceShell>
  );
}

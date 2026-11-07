import {
  Bell,
  CalendarClock,
  CalendarDays,
  CreditCard,
  Globe,
  LogOut,
  MailPlus,
  Package,
  Scissors,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandLogo } from "@/components/glowflow/brand-logo";
import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { staffInvitationManagementEnabled } from "@/lib/staff-invitations";
import { signOut } from "../auth-actions";

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
    <main className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="hidden border-r border-border bg-muted px-4 py-6 lg:flex lg:flex-col" aria-label={labels.navigation}>
        <Link href={`/${locale}/dashboard`} className="inline-flex min-h-12 items-center px-2 text-foreground focus-visible:outline-2 focus-visible:outline-primary">
          <BrandLogo className="h-10 w-36" />
        </Link>
        <div className="mt-5 rounded-2xl border border-border bg-card p-3">
          <p className="truncate text-sm font-semibold">{tenant.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{tenant.country_code} · {tenant.currency}</p>
        </div>
        <nav aria-label={labels.navigation} className="mt-6 space-y-1">
          <Link href={`/${locale}/dashboard`} aria-current="page" className="flex min-h-11 items-center gap-3 rounded-xl bg-secondary px-3 text-sm font-semibold text-secondary-foreground"><CalendarClock className="size-4" aria-hidden="true" />{labels.today}</Link>
          {links.map(({ route, title, icon: Icon }) => <Link key={route} href={`/${locale}/dashboard/${route}`} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-foreground hover:bg-card focus-visible:outline-2 focus-visible:outline-primary"><Icon className="size-4 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />{title}</Link>)}
        </nav>
        <div className="mt-auto border-t border-border pt-5 text-sm text-muted-foreground">{profile.full_name}</div>
      </aside>

      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-5 py-4 sm:px-8">
          <Link href={`/${locale}/dashboard`} className="inline-flex items-center text-foreground lg:hidden" aria-label="GlowFlow"><BrandLogo className="h-9 w-32" /></Link>
          <span className="hidden text-sm font-medium text-muted-foreground lg:block">{tenant.name}</span>
          <div className="flex items-center gap-2"><LanguageSwitcher locale={locale} /><form action={signOut.bind(null, locale)}><button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-input bg-card px-4 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary"><LogOut className="size-4" aria-hidden="true" /><span className="hidden sm:inline">{labels.signOut}</span></button></form></div>
        </header>

        <div className="mx-auto max-w-7xl px-5 pb-28 pt-10 sm:px-8 sm:pt-14 lg:pb-16">
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
        </div>

        <nav aria-label={labels.navigation} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-card/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_-20px_rgba(42,33,41,0.25)] backdrop-blur lg:hidden">
          <Link href={`/${locale}/dashboard`} aria-current="page" className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold text-primary"><CalendarClock className="size-5" aria-hidden="true" />{labels.today}</Link>
          <Link href={`/${locale}/dashboard/calendar`} className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-5" aria-hidden="true" />{labels.calendar}</Link>
          <Link href={`/${locale}/dashboard/clients`} className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs text-muted-foreground"><UsersRound className="size-5" aria-hidden="true" />{labels.clients}</Link>
          <Link href={`/${locale}/dashboard/walk-ins`} className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs text-muted-foreground"><Scissors className="size-5" aria-hidden="true" />{labels.walkIns}</Link>
        </nav>
      </div>
    </main>
  );
}

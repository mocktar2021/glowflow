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
import type { ReactNode } from "react";

import { signOut } from "@/app/[locale]/auth-actions";
import { BrandLogo } from "@/components/glowflow/brand-logo";
import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { requireUser } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";
import { staffInvitationManagementEnabled } from "@/lib/staff-invitations";

const copy = {
  fr: {
    navigation: "Gestion du salon", today: "Aujourd’hui", calendar: "Calendrier", walkIns: "Sans rendez-vous",
    clients: "Clients", notifications: "Historique des notifications", services: "Prestations", products: "Produits",
    availability: "Équipe et disponibilités", invitations: "Inviter l’équipe", profile: "Profil public",
    payments: "Paiements", signOut: "Se déconnecter",
  },
  en: {
    navigation: "Salon management", today: "Today", calendar: "Calendar", walkIns: "Walk-ins",
    clients: "Clients", notifications: "Notification history", services: "Service catalog", products: "Products",
    availability: "Team and availability", invitations: "Invite team", profile: "Public profile",
    payments: "Payments", signOut: "Sign out",
  },
  es: {
    navigation: "Gestión del salón", today: "Hoy", calendar: "Calendario", walkIns: "Sin cita",
    clients: "Clientes", notifications: "Historial de notificaciones", services: "Servicios", products: "Productos",
    availability: "Equipo y disponibilidad", invitations: "Invitar al equipo", profile: "Perfil público",
    payments: "Pagos", signOut: "Cerrar sesión",
  },
} as const;

type WorkspaceRoute = "today" | "calendar" | "clients";

export async function WorkspaceShell({
  locale, active, children,
}: {
  locale: Locale;
  active: WorkspaceRoute;
  children: ReactNode;
}) {
  const { supabase, userId } = await requireUser(locale);
  const { data: profile } = await supabase.from("users")
    .select("full_name,tenant_id").eq("id", userId).single();
  if (!profile?.tenant_id) notFound();
  const { data: tenant } = await supabase.from("tenants")
    .select("name,owner_id,country_code,currency").eq("id", profile.tenant_id).single();
  if (!tenant) notFound();

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
  const mobileLinks = [
    { route: "", title: labels.today, icon: CalendarClock, current: active === "today" },
    { route: "calendar", title: labels.calendar, icon: CalendarDays, current: active === "calendar" },
    { route: "clients", title: labels.clients, icon: UsersRound, current: active === "clients" },
    { route: "walk-ins", title: labels.walkIns, icon: Scissors, current: false },
  ];

  return <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
    <aside className="hidden border-r border-border bg-muted px-4 py-6 lg:flex lg:flex-col" aria-label={labels.navigation}>
      <Link href={`/${locale}/dashboard`} className="inline-flex min-h-12 items-center px-2 text-foreground focus-visible:outline-2 focus-visible:outline-primary">
        <BrandLogo className="h-10 w-36" />
      </Link>
      <div className="mt-5 rounded-2xl border border-border bg-card p-3">
        <p className="truncate text-sm font-semibold">{tenant.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{tenant.country_code} · {tenant.currency}</p>
      </div>
      <nav aria-label={labels.navigation} className="mt-6 space-y-1">
        <Link href={`/${locale}/dashboard`} aria-current={active === "today" ? "page" : undefined}
          className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary ${active === "today" ? "bg-secondary text-secondary-foreground" : "text-foreground hover:bg-card"}`}>
          <CalendarClock className="size-4" aria-hidden="true" />{labels.today}
        </Link>
        {links.map(({ route, title, icon: Icon }) => <Link key={route} href={`/${locale}/dashboard/${route}`}
          aria-current={active === route ? "page" : undefined}
          className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary ${active === route ? "bg-secondary font-semibold text-secondary-foreground" : "text-foreground hover:bg-card"}`}>
          <Icon className="size-4" strokeWidth={1.6} aria-hidden="true" />{title}
        </Link>)}
      </nav>
      <div className="mt-auto border-t border-border pt-5 text-sm text-muted-foreground">{profile.full_name}</div>
    </aside>

    <div className="flex h-dvh min-w-0 flex-col lg:block lg:h-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-5 py-4 sm:px-8">
        <Link href={`/${locale}/dashboard`} className="inline-flex items-center text-foreground lg:hidden" aria-label="GlowFlow">
          <BrandLogo className="h-9 w-32" />
        </Link>
        <span className="hidden text-sm font-medium text-muted-foreground lg:block">{tenant.name}</span>
        <div className="flex items-center gap-2"><LanguageSwitcher locale={locale} />
          <form action={signOut.bind(null, locale)}><button type="submit" aria-label={labels.signOut}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-input bg-card px-4 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary">
            <LogOut className="size-4" aria-hidden="true" /><span className="hidden sm:inline">{labels.signOut}</span>
          </button></form>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-visible">{children}</div>
      <nav aria-label={labels.navigation} className="z-30 grid grid-cols-4 border-t border-border bg-card/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_-20px_rgba(42,33,41,0.25)] backdrop-blur lg:hidden">
        {mobileLinks.map(({ route, title, icon: Icon, current }) => <Link key={route} href={`/${locale}/dashboard${route ? `/${route}` : ""}`}
          aria-current={current ? "page" : undefined}
          className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs focus-visible:outline-2 focus-visible:outline-primary ${current ? "font-semibold text-primary" : "text-muted-foreground"}`}>
          <Icon className="size-5" aria-hidden="true" />{title}
        </Link>)}
      </nav>
    </div>
  </div>;
}

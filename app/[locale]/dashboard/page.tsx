import { CalendarClock, CalendarDays, CreditCard, Globe, LogOut, Package, Scissors, UsersRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { signOut } from "../auth-actions";

export const dynamic = "force-dynamic";

const copy = {
  fr: { greeting: "Bonjour", subtitle: "Votre espace de travail pour gérer le salon.", signOut: "Se déconnecter", navigation: "Gestion du salon", calendar: "Calendrier", walkIns: "Sans rendez-vous", services: "Prestations", products: "Produits", availability: "Équipe et disponibilités", profile: "Profil public", payments: "Paiements" },
  en: { greeting: "Hi", subtitle: "Your workspace for running the salon.", signOut: "Sign out", navigation: "Salon management", calendar: "Calendar", walkIns: "Walk-ins", services: "Service catalog", products: "Products", availability: "Team and availability", profile: "Public profile", payments: "Payments" },
  es: { greeting: "Hola", subtitle: "Tu espacio de trabajo para gestionar el salón.", signOut: "Cerrar sesión", navigation: "Gestión del salón", calendar: "Calendario", walkIns: "Sin cita", services: "Servicios", products: "Productos", availability: "Equipo y disponibilidad", profile: "Perfil público", payments: "Pagos" },
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
  const links = [
    { route: "calendar", title: labels.calendar, icon: CalendarDays },
    { route: "walk-ins", title: labels.walkIns, icon: UsersRound },
    ...(tenant.owner_id === userId ? [
      { route: "services", title: labels.services, icon: Scissors },
      { route: "products", title: labels.products, icon: Package },
      { route: "availability", title: labels.availability, icon: CalendarClock },
      { route: "public-profile", title: labels.profile, icon: Globe },
      { route: "payments", title: labels.payments, icon: CreditCard },
    ] : []),
  ];
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: tenant.time_zone }).format(new Date());
  return (
    <main className="min-h-screen bg-[#faf9f6] text-slate-950 dark:bg-[#0f1115] dark:text-stone-50">
      <header className="border-b border-[#e8dfd2] dark:border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <span className="text-2xl font-semibold tracking-tight">GlowFlow</span>
          <div className="flex flex-wrap items-center gap-3">
            <LanguageSwitcher locale={locale} />
            <form action={signOut.bind(null, locale)}><button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#dfd2c1] px-4 text-sm font-semibold hover:bg-[#f4ede3] dark:border-white/15 dark:hover:bg-white/10"><LogOut className="size-4" />{labels.signOut}</button></form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="text-sm font-medium text-[#a56d37] dark:text-[#e8bb82]">{date} · {tenant.time_zone}</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{labels.greeting}, {profile.full_name}</h1>
        <p className="mt-3 text-lg font-medium">{tenant.name}</p>
        <p className="mt-2 text-slate-500 dark:text-stone-400">{labels.subtitle}</p>
        <p className="mt-3 text-sm text-slate-500 dark:text-stone-400">{tenant.country_code} · {tenant.currency}</p>
        <nav aria-label={labels.navigation} className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {links.map(({ route, title, icon: Icon }) => (
            <Link key={route} href={`/${locale}/dashboard/${route}`} className="group rounded-3xl border border-[#e4d6c5] bg-white p-6 shadow-sm transition hover:border-[#b77a42] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b77a42] focus-visible:ring-offset-4 dark:border-white/10 dark:bg-[#17191e] dark:hover:border-[#e8bb82]">
              <Icon className="size-6 text-[#95602e] dark:text-[#e8bb82]" />
              <h2 className="mt-5 text-xl font-semibold">{title}</h2>
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}

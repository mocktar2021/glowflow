"use client";

import {
  Bell,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  HeartHandshake,
  LayoutDashboard,
  MessageCircleMore,
  MoreHorizontal,
  Plus,
  Scissors,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  UsersRound,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { Locale } from "@/lib/i18n";

type Appointment = {
  time: string;
  client: string;
  initials: string;
  service: "color" | "gel" | "braids" | "facial" | "refill";
  duration: number;
  status: "inProgress" | "confirmed" | "pending" | "completed";
  price: number;
  accent: string;
  phone: string;
  email: string;
};

const appointments: Appointment[] = [
  {
    time: "09:00",
    client: "Sofia Martinez",
    initials: "SM",
    service: "color",
    duration: 90,
    status: "completed",
    price: 125,
    accent: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200",
    phone: "+33 6 14 82 09 31",
    email: "sofia.m@example.com",
  },
  {
    time: "11:00",
    client: "Nadia Benali",
    initials: "NB",
    service: "gel",
    duration: 60,
    status: "inProgress",
    price: 72,
    accent: "bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-200",
    phone: "+33 6 72 44 18 05",
    email: "nadia.b@example.com",
  },
  {
    time: "12:30",
    client: "Aïcha Diallo",
    initials: "AD",
    service: "braids",
    duration: 150,
    status: "confirmed",
    price: 160,
    accent: "bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-200",
    phone: "+33 7 18 92 31 06",
    email: "aicha.d@example.com",
  },
  {
    time: "15:30",
    client: "Claire Dupont",
    initials: "CD",
    service: "facial",
    duration: 75,
    status: "confirmed",
    price: 95,
    accent: "bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200",
    phone: "+33 6 40 11 27 88",
    email: "claire.d@example.com",
  },
];

const queue = [
  { name: "Maya Laurent", service: "gel" as const, wait: "8 min", ready: true },
  { name: "Lina Costa", service: "refill" as const, wait: "18 min", ready: false },
  { name: "Emma Petit", service: "facial" as const, wait: "27 min", ready: false },
];

export function DashboardShell({ locale }: { locale: Locale }) {
  const t = useTranslations();
  const [selectedClient, setSelectedClient] = useState<Appointment | null>(null);

  const navItems: Array<{
    key: "overview" | "calendar" | "walkIns" | "clients" | "services" | "checkout";
    icon: typeof CalendarDays;
    active?: boolean;
    badge?: string;
  }> = [
    { key: "overview", icon: LayoutDashboard, active: true },
    { key: "calendar", icon: CalendarDays },
    { key: "walkIns", icon: UsersRound, badge: "3" },
    { key: "clients", icon: Users },
    { key: "services", icon: Scissors },
    { key: "checkout", icon: WalletCards },
  ];

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r border-[#eadfce] bg-[#f4ede3] dark:border-white/10 dark:bg-[#151515]">
        <SidebarHeader className="px-3 pb-5 pt-4">
          <div className="flex items-center gap-3 px-1">
            <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-slate-950 text-[#f2c485] shadow-[0_8px_30px_rgba(15,23,42,0.18)] dark:bg-[#e7b779] dark:text-slate-950">
              <Sparkles className="size-5" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="text-[1.35rem] font-semibold tracking-[-0.04em] text-slate-950 dark:text-stone-50">
                GlowFlow
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-stone-400">
                {t("nav.workspace")}
              </p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1.5">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        isActive={item.active}
                        tooltip={t(`nav.${item.key}`)}
                        className="h-11 rounded-xl px-3 data-[active=true]:bg-slate-950 data-[active=true]:text-white dark:data-[active=true]:bg-[#e8bb82] dark:data-[active=true]:text-slate-950"
                      >
                        <Icon className="size-[1.15rem]" />
                        <span>{t(`nav.${item.key}`)}</span>
                        {item.badge ? (
                          <span className="ml-auto rounded-full bg-[#e8bb82] px-2 py-0.5 text-xs font-semibold text-slate-950 group-data-[collapsible=icon]:hidden">
                            {item.badge}
                          </span>
                        ) : null}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={t("nav.settings")} className="h-11 rounded-xl px-3">
                <Settings2 />
                <span>{t("nav.settings")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="h-14 rounded-2xl border border-[#dfcaa9] bg-white/60 px-2 dark:border-white/10 dark:bg-white/5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e8bb82] text-sm font-bold text-slate-950">
                  AB
                </span>
                <span className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="font-semibold">Atelier Belle</span>
                  <span className="text-xs text-slate-500 dark:text-stone-400">Paris 11e</span>
                </span>
                <MoreHorizontal className="group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 overflow-hidden bg-[#faf9f6] dark:bg-[#0f1115]">
        <header className="sticky top-0 z-20 flex h-[4.5rem] items-center justify-between border-b border-[#e8dfd2] bg-[#faf9f6]/90 px-4 backdrop-blur-xl dark:border-white/10 dark:bg-[#0f1115]/90 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger className="size-10 rounded-xl md:hidden" aria-label={t("common.openMenu")} />
            <div className="hidden items-center gap-2 text-sm font-medium text-slate-500 sm:flex dark:text-stone-400">
              <CalendarRange className="size-4 text-[#b98243]" />
              <span>Mar. 8 sept. 2026</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher locale={locale} />
            <Button variant="ghost" size="icon" className="relative size-10 rounded-full" aria-label="Notifications">
              <Bell className="size-[1.1rem]" />
              <span className="absolute right-2 top-2 size-2 rounded-full bg-[#c97857] ring-2 ring-[#faf9f6] dark:ring-[#0f1115]" />
            </Button>
            <div className="hidden size-10 place-items-center rounded-full bg-slate-950 text-sm font-semibold text-white sm:grid dark:bg-[#e8bb82] dark:text-slate-950">
              AM
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1500px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#a56d37]">
                <span className="size-2 rounded-full bg-[#d28b5f]" />
                {t("common.today")}
              </div>
              <h1 className="text-3xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-[2.65rem] dark:text-stone-50">
                {t("dashboard.greeting")}
              </h1>
              <p className="mt-2 max-w-2xl text-base leading-7 text-slate-500 dark:text-stone-400">
                {t("dashboard.subtitle")}
              </p>
            </div>
            <Button className="h-12 rounded-full bg-slate-950 px-5 text-white shadow-[0_12px_32px_rgba(15,23,42,0.16)] hover:bg-slate-800 dark:bg-[#e8bb82] dark:text-slate-950 dark:hover:bg-[#dca96c]">
              <Plus className="size-4" />
              {t("dashboard.newAppointment")}
            </Button>
          </div>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
            <MetricCard icon={CalendarDays} label={t("dashboard.appointments")} value="8" detail="6 · 2" tone="slate" />
            <MetricCard icon={CircleDollarSign} label={t("dashboard.revenue")} value="1 248 €" detail={t("dashboard.versus")} tone="gold" />
            <MetricCard icon={ShieldCheck} label={t("dashboard.deposits")} value="312 €" detail={`100 % ${t("dashboard.paid")}`} tone="rose" />
            <MetricCard icon={HeartHandshake} label={t("dashboard.noShows")} value="3" detail={t("dashboard.protected")} tone="plum" />
          </section>

          <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(330px,0.8fr)]">
            <Card className="overflow-hidden rounded-[1.75rem] border-[#e7ddd0] bg-white shadow-[0_24px_60px_rgba(50,35,20,0.06)] dark:border-white/10 dark:bg-[#17191e]">
              <div className="flex items-center justify-between border-b border-[#eee5da] px-5 py-5 sm:px-6 dark:border-white/10">
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.025em]">{t("dashboard.schedule")}</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-stone-400">{t("dashboard.scheduleMeta")}</p>
                </div>
                <Button variant="ghost" className="hidden rounded-full text-[#95602e] sm:flex">
                  {t("dashboard.viewCalendar")}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
              <CardContent className="p-3 sm:p-4">
                <div className="relative space-y-2 before:absolute before:bottom-9 before:left-[2.6rem] before:top-9 before:w-px before:bg-[#eadfce] dark:before:bg-white/10 sm:before:left-[3.2rem]">
                  {appointments.map((appointment) => (
                    <button
                      key={`${appointment.time}-${appointment.client}`}
                      type="button"
                      onClick={() => setSelectedClient(appointment)}
                      className="group relative grid w-full grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-[#fbf6ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c28b50] dark:hover:bg-white/5 sm:grid-cols-[4rem_minmax(0,1fr)]"
                    >
                      <div className="relative z-10 grid h-12 place-items-center rounded-xl bg-white text-sm font-semibold tabular-nums text-slate-500 ring-4 ring-white dark:bg-[#17191e] dark:text-stone-400 dark:ring-[#17191e]">
                        {appointment.time}
                      </div>
                      <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-[#eee6dc] bg-[#fdfcf9] p-3.5 transition group-hover:border-[#dbc09d] dark:border-white/10 dark:bg-[#121419] dark:group-hover:border-[#d7a66d]/50 sm:p-4">
                        <span className={`grid size-11 shrink-0 place-items-center rounded-2xl text-sm font-bold ${appointment.accent}`}>
                          {appointment.initials}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="truncate font-semibold text-slate-950 dark:text-stone-50">{appointment.client}</span>
                            <StatusBadge status={appointment.status} label={t(`dashboard.${appointment.status}`)} />
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-500 dark:text-stone-400">
                            <span className="truncate">{t(`services.${appointment.service}`)}</span>
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Clock3 className="size-3.5" />
                              {appointment.duration} {t("common.min")}
                            </span>
                          </span>
                        </span>
                        <span className="hidden text-right sm:block">
                          <span className="block font-semibold tabular-nums">{appointment.price} €</span>
                          <span className="text-xs text-slate-500 dark:text-stone-400">{t("dashboard.paid")}</span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#a56d37] dark:text-stone-600" />
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid content-start gap-5">
              <Card className="rounded-[1.75rem] border-[#e7ddd0] bg-white shadow-[0_24px_60px_rgba(50,35,20,0.05)] dark:border-white/10 dark:bg-[#17191e]">
                <div className="flex items-center justify-between px-5 pb-3 pt-5">
                  <div>
                    <h2 className="text-lg font-semibold">{t("dashboard.walkInQueue")}</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-stone-400">{t("dashboard.walkInMeta")}</p>
                  </div>
                  <Button variant="outline" size="sm" className="h-9 rounded-full border-[#decaa6]">
                    <Plus className="size-3.5" />
                    {t("dashboard.addWalkIn")}
                  </Button>
                </div>
                <CardContent className="space-y-2 p-3 pt-1">
                  {queue.map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-3 rounded-2xl border border-transparent px-3 py-3 hover:border-[#ead8bf] hover:bg-[#fdf9f3] dark:hover:border-white/10 dark:hover:bg-white/5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-white/10 dark:text-stone-300">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{entry.name}</span>
                        <span className="block truncate text-xs text-slate-500 dark:text-stone-400">{t(`services.${entry.service}`)}</span>
                      </span>
                      <Badge className={entry.ready ? "rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-400/15 dark:text-emerald-200" : "rounded-full bg-stone-100 text-stone-600 hover:bg-stone-100 dark:bg-white/10 dark:text-stone-300"}>
                        {entry.ready ? t("dashboard.ready") : entry.wait}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden rounded-[1.75rem] border-0 bg-slate-950 text-white shadow-[0_24px_60px_rgba(15,23,42,0.16)] dark:bg-[#e7b779] dark:text-slate-950">
                <div className="absolute -right-8 -top-10 size-36 rounded-full border border-white/10 dark:border-slate-950/10" />
                <div className="absolute -right-1 top-5 size-20 rounded-full border border-[#e8bb82]/35 dark:border-slate-950/10" />
                <CardContent className="relative p-6">
                  <span className="mb-5 grid size-11 place-items-center rounded-2xl bg-white/10 text-[#f0c184] dark:bg-slate-950/10 dark:text-slate-950">
                    <ShieldCheck className="size-5" />
                  </span>
                  <h2 className="text-xl font-semibold tracking-[-0.025em]">{t("dashboard.noShowShield")}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300 dark:text-slate-800">{t("dashboard.shieldText")}</p>
                  <Progress value={78} className="mt-5 h-2 bg-white/10 dark:bg-slate-950/10 [&_[data-slot=progress-indicator]]:bg-[#e8bb82] dark:[&_[data-slot=progress-indicator]]:bg-slate-950" />
                  <div className="mt-4 flex items-center gap-2 text-xs text-slate-400 dark:text-slate-700">
                    <MessageCircleMore className="size-4" />
                    {t("dashboard.nextReminder")}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 rounded-[1.4rem] border border-[#decfb9] bg-[#fffdf9]/95 p-1.5 shadow-[0_14px_40px_rgba(36,25,15,0.16)] backdrop-blur-xl dark:border-white/10 dark:bg-[#17191e]/95 md:hidden" aria-label="Mobile navigation">
          <MobileNavItem icon={LayoutDashboard} label={t("nav.overview")} active />
          <MobileNavItem icon={CalendarDays} label={t("nav.calendar")} />
          <button className="mx-auto -mt-5 grid size-14 place-items-center rounded-full bg-slate-950 text-white shadow-lg ring-4 ring-[#faf9f6] dark:bg-[#e7b779] dark:text-slate-950 dark:ring-[#0f1115]" aria-label={t("nav.newBooking")}>
            <Plus className="size-5" />
          </button>
          <MobileNavItem icon={Users} label={t("nav.clients")} />
          <MobileNavItem icon={CreditCard} label={t("nav.checkout")} />
        </nav>
      </SidebarInset>

      <ClientProfileDrawer
        appointment={selectedClient}
        onOpenChange={(open) => !open && setSelectedClient(null)}
        locale={locale}
      />
    </SidebarProvider>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  detail: string;
  tone: "slate" | "gold" | "rose" | "plum";
}) {
  const tones = {
    slate: "bg-slate-950 text-white dark:bg-stone-100 dark:text-slate-950",
    gold: "bg-[#f2e4ca] text-[#8a5728] dark:bg-[#d7a45f]/20 dark:text-[#efc992]",
    rose: "bg-[#f2ded7] text-[#a65f47] dark:bg-[#d78063]/20 dark:text-[#efae96]",
    plum: "bg-[#e7dfea] text-[#76517f] dark:bg-[#ae78ba]/20 dark:text-[#d9a8e2]",
  };

  return (
    <Card className="rounded-[1.55rem] border-[#e7ddd0] bg-white shadow-[0_18px_40px_rgba(50,35,20,0.045)] dark:border-white/10 dark:bg-[#17191e]">
      <CardContent className="flex items-start gap-4 p-5">
        <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${tones[tone]}`}>
          <Icon className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-500 dark:text-stone-400">{label}</span>
          <span className="mt-1 block text-2xl font-semibold tracking-[-0.035em] tabular-nums">{value}</span>
          <span className="mt-1 block truncate text-xs text-slate-400 dark:text-stone-500">{detail}</span>
        </span>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, label }: { status: Appointment["status"]; label: string }) {
  const styles = {
    inProgress: "bg-[#f6e1d2] text-[#a05536] dark:bg-[#d77855]/15 dark:text-[#f2ae91]",
    confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200",
    pending: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200",
    completed: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-stone-300",
  };

  return <Badge className={`rounded-full border-0 text-[0.7rem] hover:${styles[status]} ${styles[status]}`}>{label}</Badge>;
}

function MobileNavItem({ icon: Icon, label, active = false }: { icon: typeof CalendarDays; label: string; active?: boolean }) {
  return (
    <button className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[0.68rem] ${active ? "text-slate-950 dark:text-[#e7b779]" : "text-slate-400 dark:text-stone-500"}`}>
      <Icon className="size-[1.15rem]" />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

function ClientProfileDrawer({
  appointment,
  onOpenChange,
  locale,
}: {
  appointment: Appointment | null;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
}) {
  const t = useTranslations();

  return (
    <Sheet open={Boolean(appointment)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto border-l-[#e7ddd0] bg-[#fbfaf7] p-0 dark:border-l-white/10 dark:bg-[#14161a] sm:max-w-xl">
        {appointment ? (
          <>
            <div className="bg-slate-950 px-6 pb-8 pt-7 text-white dark:bg-[#e7b779] dark:text-slate-950">
              <SheetHeader className="p-0">
                <div className="mb-6 flex items-center justify-between pr-8 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-700">
                  <span>{t("dashboard.clientFile")}</span>
                  <span>#{appointment.initials}204</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`grid size-16 place-items-center rounded-[1.3rem] text-lg font-bold ${appointment.accent}`}>
                    {appointment.initials}
                  </span>
                  <div>
                    <SheetTitle className="text-2xl tracking-[-0.03em] text-white dark:text-slate-950">{appointment.client}</SheetTitle>
                    <SheetDescription className="mt-1 text-slate-400 dark:text-slate-700">{t("dashboard.clientSince")}</SheetDescription>
                  </div>
                </div>
              </SheetHeader>
            </div>

            <div className="space-y-5 p-5 sm:p-6">
              <section className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-[#e8ded1] bg-white p-4 dark:border-white/10 dark:bg-white/5">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{t("dashboard.contact")}</span>
                  <p className="mt-3 text-sm font-medium">{appointment.phone}</p>
                  <p className="mt-1 truncate text-xs text-slate-500 dark:text-stone-400">{appointment.email}</p>
                </div>
                <div className="rounded-2xl border border-[#e8ded1] bg-white p-4 dark:border-white/10 dark:bg-white/5">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{t("dashboard.allergy")}</span>
                  <p className="mt-3 flex items-start gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    <Check className="mt-0.5 size-4 shrink-0" />
                    {t("dashboard.allergyClear")}
                  </p>
                </div>
              </section>

              <section className="rounded-[1.4rem] border border-[#e8ded1] bg-white p-5 dark:border-white/10 dark:bg-white/5">
                <div className="mb-4 flex items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-xl bg-[#f1e3cb] text-[#9a6531] dark:bg-[#d7a45f]/15 dark:text-[#efc992]">
                    <Sparkles className="size-4" />
                  </span>
                  <h3 className="font-semibold">{t("dashboard.formulaHistory")}</h3>
                </div>
                <div className="space-y-4 border-l border-[#e4d4bd] pl-4 dark:border-white/10">
                  <HistoryItem date="18 août 2026" title="Racines · blond cendré" detail="7.1 Ash Blonde + 20 vol · 35 min" />
                  <HistoryItem date="03 juin 2026" title="Patine froide" detail="9.12 + clear 1:1 · 18 min" />
                  <HistoryItem date="22 avril 2026" title="Balayage entretien" detail="Powder lightener + 20 vol · 42 min" />
                </div>
              </section>

              <section className="rounded-[1.4rem] border border-[#e8ded1] bg-white p-5 dark:border-white/10 dark:bg-white/5">
                <div className="mb-4 flex items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-xl bg-[#f1deda] text-[#a35c48] dark:bg-[#d77855]/15 dark:text-[#efae96]">
                    <Star className="size-4" />
                  </span>
                  <h3 className="font-semibold">{t("dashboard.nailHistory")}</h3>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl bg-[#f7f2eb] p-3 dark:bg-white/5"><strong className="block text-sm">Almond</strong>Shape</div>
                  <div className="rounded-xl bg-[#f7f2eb] p-3 dark:bg-white/5"><span className="mx-auto mb-1 block size-5 rounded-full bg-[#7e2635] ring-2 ring-white" />Bordeaux 18</div>
                  <div className="rounded-xl bg-[#f7f2eb] p-3 dark:bg-white/5"><strong className="block text-sm">12 d</strong>Infill</div>
                </div>
              </section>
            </div>

            <SheetFooter className="sticky bottom-0 border-t border-[#e8ded1] bg-[#fbfaf7]/95 p-5 backdrop-blur dark:border-white/10 dark:bg-[#14161a]/95">
              <Button className="h-12 w-full rounded-full bg-slate-950 text-white hover:bg-slate-800 dark:bg-[#e7b779] dark:text-slate-950">
                <CalendarDays className="size-4" />
                {t("dashboard.bookAgain")}
              </Button>
              <Link href={`/${locale}/book/atelier-belle`} className="text-center text-xs text-slate-500 underline-offset-4 hover:underline dark:text-stone-400">
                glowflow.app/book/atelier-belle
              </Link>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function HistoryItem({ date, title, detail }: { date: string; title: string; detail: string }) {
  return (
    <div className="relative before:absolute before:-left-[1.28rem] before:top-1.5 before:size-2 before:rounded-full before:bg-[#c98b50] before:ring-4 before:ring-white dark:before:ring-[#202227]">
      <p className="text-xs text-slate-400">{date}</p>
      <p className="mt-1 text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-stone-400">{detail}</p>
    </div>
  );
}

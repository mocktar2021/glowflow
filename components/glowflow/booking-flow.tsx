"use client";

import {
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  AtSign,
  MapPin,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Locale } from "@/lib/i18n";

const serviceOptions = [
  { id: "gel", key: "gel", duration: 60, price: 72, deposit: 24 },
  { id: "color", key: "color", duration: 90, price: 125, deposit: 40 },
  { id: "facial", key: "facial", duration: 75, price: 95, deposit: 30 },
] as const;

const times = ["09:30", "11:00", "13:30", "15:00", "17:30"];

export function BookingFlow({ locale, salonSlug }: { locale: Locale; salonSlug: string }) {
  const t = useTranslations();
  const [serviceId, setServiceId] = useState<(typeof serviceOptions)[number]["id"]>("gel");
  const [staff, setStaff] = useState("any");
  const [selectedTime, setSelectedTime] = useState("13:30");
  const [complete, setComplete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedService = useMemo(
    () => serviceOptions.find((service) => service.id === serviceId)!,
    [serviceId],
  );

  async function reserve() {
    setIsSubmitting(true);

    if (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === "true") {
      try {
        const response = await fetch("/api/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            locale,
            salonSlug,
            serviceId,
            serviceName: t(`services.${selectedService.key}`),
            depositAmount: selectedService.deposit * 100,
            appointmentTime: `2026-09-08T${selectedTime}:00+02:00`,
          }),
        });
        const data = (await response.json()) as { url?: string };
        if (response.ok && data.url) {
          window.location.assign(data.url);
          return;
        }
      } catch {
        setIsSubmitting(false);
        return;
      }
    }

    window.setTimeout(() => {
      setComplete(true);
      setIsSubmitting(false);
    }, 450);
  }

  return (
    <main className="min-h-screen bg-[#f3ece2] p-3 text-slate-950 dark:bg-[#101216] dark:text-stone-50 sm:p-5 lg:p-7">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-[1480px] overflow-hidden rounded-[2rem] bg-[#faf9f6] shadow-[0_32px_100px_rgba(48,32,18,0.12)] dark:bg-[#17191e] sm:min-h-[calc(100vh-2.5rem)] lg:grid-cols-[minmax(360px,0.82fr)_minmax(0,1.35fr)]">
        <aside className="relative min-h-[320px] overflow-hidden bg-slate-950 text-white lg:min-h-full">
          <Image
            src="/glowflow-manicure.png"
            alt="Nail artist performing a manicure at Atelier Belle"
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 40vw"
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/35 to-slate-950/10" />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-5 sm:p-7">
            <Link href={`/${locale}/dashboard`} className="flex items-center gap-2 text-lg font-semibold tracking-[-0.035em]">
              <span className="grid size-9 place-items-center rounded-xl bg-[#e7b779] text-slate-950">
                <Sparkles className="size-4" />
              </span>
              GlowFlow
            </Link>
            <LanguageSwitcher locale={locale} />
          </div>
          <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8 lg:p-10">
            <Badge className="mb-4 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-white backdrop-blur hover:bg-white/10">
              {t("booking.poweredBy")}
            </Badge>
            <h2 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Atelier Belle</h2>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-200">
              <span className="inline-flex items-center gap-1.5">
                <Star className="size-4 fill-[#e7b779] text-[#e7b779]" />
                {t("booking.rating")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4 text-[#e7b779]" />
                {t("booking.address")}
              </span>
            </div>
            <div className="mt-6 flex items-center gap-3 text-sm text-stone-300">
              <AtSign className="size-4" />
              @atelierbelle.paris
            </div>
          </div>
        </aside>

        <section className="relative p-5 sm:p-8 lg:p-10 xl:p-14">
          <div className="mx-auto max-w-3xl">
            {!complete ? (
              <>
                <div className="mb-8 lg:mb-10">
                  <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#a86c37]">Atelier Belle</p>
                  <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl lg:text-[2.8rem]">
                    {t("booking.title")}
                  </h1>
                  <p className="mt-3 text-base leading-7 text-slate-500 dark:text-stone-400">{t("booking.subtitle")}</p>
                </div>

                <div className="space-y-8">
                  <BookingSection title={t("booking.stepService")}>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {serviceOptions.map((service) => {
                        const selected = service.id === serviceId;
                        return (
                          <button
                            key={service.id}
                            type="button"
                            onClick={() => setServiceId(service.id)}
                            className={`relative rounded-[1.35rem] border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#be8249] ${
                              selected
                                ? "border-slate-950 bg-slate-950 text-white shadow-[0_12px_28px_rgba(15,23,42,0.14)] dark:border-[#e7b779] dark:bg-[#e7b779] dark:text-slate-950"
                                : "border-[#e8ded1] bg-white hover:border-[#cfad82] dark:border-white/10 dark:bg-white/5 dark:hover:border-[#d7a66d]/50"
                            }`}
                            aria-pressed={selected}
                          >
                            {selected ? (
                              <span className="absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-[#e7b779] text-slate-950 dark:bg-slate-950 dark:text-white">
                                <Check className="size-3.5" />
                              </span>
                            ) : null}
                            <span className="block pr-7 text-sm font-semibold leading-5">{t(`services.${service.key}`)}</span>
                            <span className={`mt-5 flex items-end justify-between text-sm ${selected ? "text-stone-300 dark:text-slate-700" : "text-slate-500 dark:text-stone-400"}`}>
                              <span>{service.duration} {t("common.min")}</span>
                              <strong className={selected ? "text-white dark:text-slate-950" : "text-slate-950 dark:text-stone-50"}>{service.price} €</strong>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </BookingSection>

                  <BookingSection title={t("booking.stepStaff")}>
                    <Select value={staff} onValueChange={setStaff}>
                      <SelectTrigger className="h-12 w-full rounded-2xl border-[#e3d6c5] bg-white px-4 dark:border-white/10 dark:bg-white/5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-2xl">
                        <SelectItem value="any">{t("booking.anyStaff")}</SelectItem>
                        <SelectItem value="amelie">Amélie · Hair & color</SelectItem>
                        <SelectItem value="ines">Inès · Nail artist</SelectItem>
                        <SelectItem value="sara">Sara · Braids</SelectItem>
                      </SelectContent>
                    </Select>
                  </BookingSection>

                  <BookingSection title={t("booking.stepTime")}>
                    <div className="rounded-[1.5rem] border border-[#e8ded1] bg-white p-4 dark:border-white/10 dark:bg-white/5 sm:p-5">
                      <div className="mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-2 font-semibold">
                          <CalendarDays className="size-[1.1rem] text-[#ac713b]" />
                          {t("booking.date")}
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">5 slots</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {times.map((time) => (
                          <button
                            key={time}
                            type="button"
                            onClick={() => setSelectedTime(time)}
                            className={`h-11 rounded-xl text-sm font-semibold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#be8249] ${
                              selectedTime === time
                                ? "bg-[#e7b779] text-slate-950"
                                : "bg-[#f7f2eb] text-slate-600 hover:bg-[#eee1cf] dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10"
                            }`}
                          >
                            {time}
                          </button>
                        ))}
                      </div>
                    </div>
                  </BookingSection>

                  <Card className="overflow-hidden rounded-[1.6rem] border-[#ddcbae] bg-[#f7efe3] shadow-none dark:border-[#d7a66d]/20 dark:bg-[#d7a66d]/10">
                    <CardContent className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-6">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-[#9a622f] dark:text-[#efc992]">
                          <ShieldCheck className="size-[1.1rem]" />
                          {t("booking.summary")}
                        </div>
                        <p className="mt-3 font-semibold">{t(`services.${selectedService.key}`)}</p>
                        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-stone-400">
                          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />{selectedService.duration} {t("common.min")}</span>
                          <span>{t("booking.date")} · {selectedTime}</span>
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-5 border-t border-[#dac5a6] pt-4 text-sm sm:grid-cols-1 sm:gap-1 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0 sm:text-right dark:border-[#d7a66d]/20">
                        <PriceLine label={t("booking.total")} value={`${selectedService.price} €`} strong />
                        <PriceLine label={t("booking.deposit")} value={`${selectedService.deposit} €`} accent />
                        <PriceLine label={t("booking.balance")} value={`${selectedService.price - selectedService.deposit} €`} />
                      </div>
                    </CardContent>
                  </Card>

                  <div>
                    <Button
                      onClick={reserve}
                      disabled={isSubmitting}
                      className="h-14 w-full rounded-full bg-slate-950 text-base text-white shadow-[0_16px_36px_rgba(15,23,42,0.16)] hover:bg-slate-800 dark:bg-[#e7b779] dark:text-slate-950 dark:hover:bg-[#dca96c]"
                    >
                      <CreditCard className="size-[1.1rem]" />
                      {isSubmitting ? "…" : `${t("booking.reserve")} · ${selectedService.deposit} €`}
                    </Button>
                    <div className="mt-3 flex items-center justify-center gap-2 text-center text-xs leading-5 text-slate-500 dark:text-stone-400">
                      <ShieldCheck className="size-3.5 shrink-0" />
                      <span>{t("booking.secure")}</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="grid min-h-[65vh] place-items-center py-10 text-center">
                <div className="max-w-md">
                  <span className="mx-auto grid size-20 place-items-center rounded-[1.8rem] bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
                    <CheckCircle2 className="size-9" />
                  </span>
                  <Badge className="mt-7 rounded-full bg-[#f0e1ca] text-[#8e5929] hover:bg-[#f0e1ca] dark:bg-[#d7a66d]/15 dark:text-[#efc992]">
                    {t("booking.demo")}
                  </Badge>
                  <h1 className="mt-4 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{t("booking.successTitle")}</h1>
                  <p className="mt-4 text-base leading-7 text-slate-500 dark:text-stone-400">{t("booking.successText")}</p>
                  <div className="mt-7 rounded-[1.5rem] border border-[#e8ded1] bg-white p-5 text-left dark:border-white/10 dark:bg-white/5">
                    <p className="font-semibold">{t(`services.${selectedService.key}`)}</p>
                    <p className="mt-2 text-sm text-slate-500 dark:text-stone-400">{t("booking.date")} · {selectedTime}</p>
                    <div className="mt-4 flex items-center justify-between border-t border-[#eee5da] pt-4 dark:border-white/10">
                      <span className="text-sm">{t("booking.deposit")}</span>
                      <strong>{selectedService.deposit} €</strong>
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => setComplete(false)} className="mt-6 h-12 rounded-full border-[#decaa6] px-6">
                    {t("booking.back")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function BookingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-stone-400">{title}</h2>
      {children}
    </section>
  );
}

function PriceLine({ label, value, strong = false, accent = false }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <span className={strong ? "font-semibold" : ""}>
      <span className="block text-xs text-slate-500 dark:text-stone-400">{label}</span>
      <span className={`mt-0.5 block ${accent ? "font-semibold text-[#9a622f] dark:text-[#efc992]" : ""}`}>{value}</span>
    </span>
  );
}

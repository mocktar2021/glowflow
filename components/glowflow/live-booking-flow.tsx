"use client";

import { CalendarDays, CheckCircle2, Clock3, MapPin, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import type { Locale } from "@/lib/i18n";
import { sandboxPaymentCopy } from "@/lib/sandbox-payment-copy";

type Service = {
  id: string;
  title_json: Record<string, string>;
  duration_minutes: number;
  price: number;
  deposit_amount: number;
  currency: string;
};

type Slot = { slot_start: string; staff_id: string };
type Confirmation = {
  appointment_id: string;
  confirmed_start: string;
  confirmed_end: string;
  salon_name: string;
  service_title: Record<string, string>;
  currency: string;
  saved_locale: Locale;
};

type Props = {
  locale: Locale;
  salon: { name: string; slug: string; city: string | null; currency: string; timeZone: string };
  services: Service[];
  sandbox?: boolean;
};

const copy = {
  fr: {
    title: "Réservez votre rendez-vous",
    subtitle: "Choisissez une prestation, une date et un créneau disponible.",
    service: "Prestation",
    date: "Date",
    staff: "Professionnel",
    anyStaff: "Sans préférence : un professionnel disponible",
    timeZone: "Horaires du salon",
    availabilityError: "Impossible de charger les créneaux. Réessayez.",
    retry: "Réessayer",
    time: "Créneaux disponibles",
    loading: "Recherche des créneaux…",
    noSlots: "Aucun créneau disponible pour cette date.",
    details: "Vos coordonnées",
    name: "Nom complet",
    phone: "Téléphone",
    email: "E-mail",
    contact: "Ajoutez un téléphone ou un e-mail.",
    reserve: "Confirmer le rendez-vous",
    saving: "Confirmation…",
    conflict: "Ce créneau vient d’être réservé. Choisissez un autre horaire.",
    error: "La réservation a échoué. Vérifiez vos informations.",
    success: "Rendez-vous confirmé",
    confirmation: "Votre rendez-vous est enregistré dans l’agenda du salon.",
    reference: "Référence",
    another: "Prendre un autre rendez-vous",
    duration: "Durée",
    deposit: "Acompte",
  },
  en: {
    title: "Book your appointment",
    subtitle: "Choose a service, date, and available time.",
    service: "Service",
    date: "Date",
    staff: "Professional",
    anyStaff: "No preference: an available professional",
    timeZone: "Salon time zone",
    availabilityError: "Available times could not be loaded. Try again.",
    retry: "Try again",
    time: "Available times",
    loading: "Checking available times…",
    noSlots: "No times are available on this date.",
    details: "Your details",
    name: "Full name",
    phone: "Phone",
    email: "Email",
    contact: "Add a phone number or email.",
    reserve: "Confirm appointment",
    saving: "Confirming…",
    conflict: "Someone booked this time. Choose another time.",
    error: "Booking failed. Review your information.",
    success: "Appointment confirmed",
    confirmation: "Your appointment is saved in the salon calendar.",
    reference: "Reference",
    another: "Book another appointment",
    duration: "Duration",
    deposit: "Deposit",
  },
  es: {
    title: "Reserva tu cita",
    subtitle: "Elige un servicio, una fecha y una hora disponible.",
    service: "Servicio",
    date: "Fecha",
    staff: "Profesional",
    anyStaff: "Sin preferencia: un profesional disponible",
    timeZone: "Zona horaria del salón",
    availabilityError: "No se pudieron cargar los horarios. Inténtalo de nuevo.",
    retry: "Reintentar",
    time: "Horas disponibles",
    loading: "Buscando horarios…",
    noSlots: "No hay horarios disponibles para esta fecha.",
    details: "Tus datos",
    name: "Nombre completo",
    phone: "Teléfono",
    email: "Correo",
    contact: "Añade un teléfono o correo.",
    reserve: "Confirmar cita",
    saving: "Confirmando…",
    conflict: "Otra persona reservó esta hora. Elige otra.",
    error: "La reserva falló. Revisa tus datos.",
    success: "Cita confirmada",
    confirmation: "Tu cita está guardada en el calendario del salón.",
    reference: "Referencia",
    another: "Reservar otra cita",
    duration: "Duración",
    deposit: "Depósito",
  },
} as const;

function dateInZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function money(amount: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100);
}

export function LiveBookingFlow({ locale, salon, services, sandbox = false }: Props) {
  const labels = copy[locale];
  const paymentLabels = sandboxPaymentCopy[locale];
  const retry = useRef<{ payload: string; key: string } | null>(null);
  const contactRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  const today = useMemo(() => dateInZone(salon.timeZone), [salon.timeZone]);
  const [serviceId, setServiceId] = useState(services[0].id);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [availabilityFailed, setAvailabilityFailed] = useState(false);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const service = services.find((item) => item.id === serviceId) ?? services[0];

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ salonSlug: salon.slug, serviceId, date });
    fetch(`/api/public-booking?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("availability_failed");
        return response.json() as Promise<{ slots: Slot[] }>;
      })
      .then(({ slots: values }) => {
        if (controller.signal.aborted) return;
        const unique = new Map<string, Slot>();
        for (const value of values) if (!unique.has(value.slot_start)) unique.set(value.slot_start, value);
        setSlots([...unique.values()]);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && (reason as { name?: string }).name !== "AbortError") setAvailabilityFailed(true);
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingSlots(false); });

    return () => controller.abort();
  }, [date, salon.slug, serviceId, availabilityVersion]);

  useEffect(() => {
    if (confirmation) confirmationRef.current?.focus();
  }, [confirmation]);

  function reloadAvailability() {
    setSlot(null);
    setSlots([]);
    setLoadingSlots(true);
    setAvailabilityFailed(false);
    setAvailabilityVersion((value) => value + 1);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!slot || loadingSlots || submitting) return;
    const form = new FormData(event.currentTarget);
    const fullName = String(form.get("fullName") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    if (!phone && !email) {
      setError(labels.contact);
      contactRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setError("");
    const payload = { salonSlug: salon.slug, serviceId, staffId: slot.staff_id, startTime: slot.slot_start, fullName, phone, email, locale };
    const fingerprint = JSON.stringify(payload);
    if (!retry.current || retry.current.payload !== fingerprint) retry.current = { payload: fingerprint, key: crypto.randomUUID() };
    try {
    const response = await fetch(sandbox ? "/api/checkout" : "/api/public-booking", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        salonSlug: salon.slug,
        serviceId,
        staffId: slot.staff_id,
        startTime: slot.slot_start,
        fullName,
        phone,
        email,
        locale,
        requestKey: retry.current.key,
      }),
    });
    const result = await response.json() as { confirmation?: Confirmation; error?: string; url?: string; reservationId?: string };
    setSubmitting(false);

    if (sandbox) {
      if (!response.ok || !result.reservationId) {
        setError(result.error === "slot_unavailable" ? labels.conflict : paymentLabels.unavailable);
        if (result.error === "slot_unavailable") reloadAvailability();
        return;
      }
      if (result.url) {
        const destination = new URL(result.url);
        if (destination.protocol !== "https:" || destination.hostname !== "checkout.stripe.com") throw new Error("invalid_checkout_url");
        window.location.assign(destination.href);
      } else {
        window.location.assign(`/${locale}/book/${salon.slug}?sandboxReservation=${encodeURIComponent(result.reservationId)}`);
      }
      return;
    }

    if (!response.ok || !result.confirmation) {
      setError(result.error === "slot_unavailable" ? labels.conflict : labels.error);
      if (result.error === "slot_unavailable") reloadAvailability();
      setSlot(null);
      return;
    }
    setConfirmation(result.confirmation);
    retry.current = null;
    } catch {
      setError(sandbox ? paymentLabels.unavailable : labels.error);
    } finally {
      setSubmitting(false);
    }
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: salon.timeZone, dateStyle: "full", timeStyle: "short",
  });

  if (confirmation) {
    return <main className="grid min-h-screen place-items-center bg-[#f3ece2] p-4 text-slate-950 dark:bg-[#101216] dark:text-stone-50">
      <section className="w-full max-w-xl rounded-[2rem] border border-[#e4d6c5] bg-[#faf9f6] p-7 text-center shadow-[0_24px_80px_rgba(48,32,18,0.12)] dark:border-white/10 dark:bg-[#17191e] sm:p-10">
        <span className="mx-auto grid size-20 place-items-center rounded-[1.75rem] bg-emerald-100 text-emerald-700"><CheckCircle2 className="size-10" /></span>
        <h1 ref={confirmationRef} tabIndex={-1} className="mt-6 text-3xl font-semibold tracking-[-0.045em]">{labels.success}</h1>
        <p className="mt-3 text-slate-600 dark:text-stone-300">{labels.confirmation}</p>
        <div className="mt-7 rounded-2xl border border-[#e8ded1] bg-white p-5 text-left dark:border-white/10 dark:bg-white/5">
          <p className="font-semibold">{confirmation.service_title[locale] ?? confirmation.service_title.fr}</p>
          <p className="mt-2 text-sm">{formatter.format(new Date(confirmation.confirmed_start))}</p>
          <p className="mt-4 border-t border-[#eee5da] pt-4 text-xs text-slate-500">{labels.reference}: {confirmation.appointment_id}</p>
        </div>
        <button type="button" onClick={() => { setConfirmation(null); reloadAvailability(); }} className="mt-6 h-12 rounded-full border border-[#d9c7b2] px-6 font-semibold">{labels.another}</button>
      </section>
    </main>;
  }

  return <main className="min-h-screen bg-[#f3ece2] p-3 text-slate-950 dark:bg-[#101216] dark:text-stone-50 sm:p-6">
    <div className="mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-[#faf9f6] shadow-[0_32px_100px_rgba(48,32,18,0.12)] dark:bg-[#17191e]">
      <header className="flex items-center justify-between bg-slate-950 px-5 py-4 text-white sm:px-8">
        <Link href={`/${locale}`} className="flex items-center gap-2 font-semibold"><Sparkles className="size-5 text-[#e7b779]" />GlowFlow</Link>
        <LanguageSwitcher locale={locale} />
      </header>
      <div className="grid lg:grid-cols-[0.75fr_1.25fr]">
        <aside className="bg-[#eadbc9] p-6 dark:bg-white/5 sm:p-9">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#9a622f]">{salon.name}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">{sandbox ? paymentLabels.title : labels.title}</h1>
          {sandbox ? <p role="note" className="mt-4 rounded-xl bg-white/70 p-4 text-sm dark:bg-black/15">{paymentLabels.notice}</p> : null}
          <p className="mt-3 leading-7 text-slate-600 dark:text-stone-300">{labels.subtitle}</p>
          {salon.city ? <p className="mt-6 flex items-center gap-2 text-sm"><MapPin className="size-4 text-[#9a622f]" />{salon.city}</p> : null}
          <div className="mt-8 rounded-2xl bg-white/70 p-5 dark:bg-black/15">
            <p className="font-semibold">{service.title_json[locale] ?? service.title_json.fr}</p>
            <p className="mt-2 text-sm text-slate-600 dark:text-stone-300">{labels.duration}: {service.duration_minutes} min</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-stone-300">{labels.deposit}: {money(service.deposit_amount, service.currency, locale)}</p>
            <p className="mt-4 text-2xl font-semibold">{money(service.price, service.currency, locale)}</p>
          </div>
        </aside>
        <form onSubmit={submit} aria-busy={submitting} className="space-y-7 p-6 sm:p-9">
          <label className="block font-semibold">{labels.service}
            <select disabled={submitting} value={serviceId} onChange={(event) => {
                setLoadingSlots(true);
                setAvailabilityFailed(false);
                setSlots([]);
                setSlot(null);
                setError("");
                setServiceId(event.target.value);
              }} className="mt-2 h-12 w-full rounded-xl border border-[#dfd2c1] bg-white px-4 dark:border-white/15 dark:bg-white/5">
              {services.map((item) => <option key={item.id} value={item.id}>{item.title_json[locale] ?? item.title_json.fr}</option>)}
            </select>
          </label>
          <div><p className="font-semibold">{labels.staff}</p><p className="mt-2 text-sm text-slate-600 dark:text-stone-300">{labels.anyStaff}</p></div>
          <label className="block font-semibold">{labels.date}
            <input type="date" disabled={submitting} min={today} value={date} onChange={(event) => {
              setLoadingSlots(true);
              setAvailabilityFailed(false);
              setSlots([]);
              setSlot(null);
              setError("");
              setDate(event.target.value);
            }} required className="mt-2 h-12 w-full rounded-xl border border-[#dfd2c1] bg-white px-4 dark:border-white/15 dark:bg-white/5" />
          </label>
          <fieldset disabled={submitting || loadingSlots} aria-busy={loadingSlots} aria-describedby="booking-time-zone">
            <legend className="flex items-center gap-2 font-semibold"><CalendarDays aria-hidden="true" className="size-5 text-[#9a622f]" />{labels.time}</legend>
            <p id="booking-time-zone" className="mt-2 text-sm text-slate-600 dark:text-stone-300">{labels.timeZone}: {salon.timeZone}</p>
            {loadingSlots ? <p role="status" className="mt-3 text-sm text-slate-500">{labels.loading}</p> : availabilityFailed ? <div role="alert" className="mt-3"><p>{labels.availabilityError}</p><button type="button" onClick={reloadAvailability} className="mt-2 min-h-11 rounded-xl border border-[#d9c7b2] px-4 font-semibold">{labels.retry}</button></div> : slots.length ? <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((value) => <label key={value.slot_start} className="cursor-pointer">
                <input type="radio" name="bookingTime" value={value.slot_start} checked={slot?.slot_start === value.slot_start} onChange={() => setSlot(value)} required className="peer sr-only" />
                <span className="flex min-h-11 items-center justify-center rounded-xl bg-[#f4ece2] text-sm font-semibold peer-checked:bg-[#e7b779] peer-checked:text-slate-950 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-slate-950 dark:bg-white/5 dark:peer-focus-visible:outline-white">
                  {new Intl.DateTimeFormat(locale, { timeZone: salon.timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(value.slot_start))}
                </span>
              </label>)}
            </div> : <p role="status" className="mt-3 rounded-xl bg-[#f4ece2] p-4 text-sm dark:bg-white/5">{labels.noSlots}</p>}
          </fieldset>
          <fieldset disabled={submitting} aria-describedby="booking-contact-hint" className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 font-semibold">{labels.details}</legend>
            <p id="booking-contact-hint" className="text-sm text-slate-600 dark:text-stone-300 sm:col-span-2">{labels.contact}</p>
            <label className="sm:col-span-2">{labels.name}<input name="fullName" autoComplete="name" minLength={2} maxLength={120} required className="mt-2 h-12 w-full rounded-xl border border-[#dfd2c1] bg-white px-4 dark:border-white/15 dark:bg-white/5" /></label>
            <label>{labels.phone}<input ref={contactRef} name="phone" type="tel" autoComplete="tel" aria-invalid={error === labels.contact} aria-describedby="booking-contact-hint" maxLength={40} className="mt-2 h-12 w-full rounded-xl border border-[#dfd2c1] bg-white px-4 dark:border-white/15 dark:bg-white/5" /></label>
            <label>{labels.email}<input name="email" type="email" autoComplete="email" aria-invalid={error === labels.contact} aria-describedby="booking-contact-hint" maxLength={160} className="mt-2 h-12 w-full rounded-xl border border-[#dfd2c1] bg-white px-4 dark:border-white/15 dark:bg-white/5" /></label>
          </fieldset>
          {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</p> : null}
          <button type="submit" disabled={!slot || loadingSlots || submitting} className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-slate-950 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 dark:bg-[#e7b779] dark:text-slate-950">
            <Clock3 className="size-5" />{submitting ? labels.saving : sandbox ? paymentLabels.pay : labels.reserve}
          </button>
        </form>
      </div>
    </div>
  </main>;
}

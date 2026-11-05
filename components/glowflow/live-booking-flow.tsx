"use client";

import { CalendarDays, CheckCircle2, Clock3, MapPin, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import type { Locale } from "@/lib/i18n";
import { sandboxPaymentCopy } from "@/lib/sandbox-payment-copy";

const noHydrationSubscription = () => () => {};

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
  appointment_status?: "confirmed" | "completed" | "canceled" | "no_show";
  confirmed_start: string;
  confirmed_end: string;
  salon_name: string;
  service_title: Record<string, string>;
  currency: string;
  saved_locale: Locale;
  details?: {
    time_zone: string | null;
    address: string | null;
    policies: Record<string, string> | null;
    catalog_price: number | null;
    currency: string | null;
    service_title: Record<string, string> | null;
  } | null;
};

type BookingPayload = {
  salonSlug: string; serviceId: string; staffId: string; startTime: string;
  fullName: string; phone: string; email: string; locale: Locale;
};

type V2OriginalPrepared = {
  intentId: string; generation: string; serviceId: string; staffId: string; startTime: string;
  serviceTitle: string; staffName: string; salonName: string; timeZone: string;
  displayedPrice: number; currency: string;
};

type V2Response = {
  ready?: boolean;
  new_session?: boolean;
  state?: "prepared" | "confirmed" | "not_committed" | "unknown" | "none";
  generation?: string;
  intent_id?: string;
  confirmation?: Confirmation;
};

class V2RequestError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds = 0, readonly action?: string) {
    super("v2_request_failed");
  }
}
type V2CapabilityAction = "commit" | "cancel" | "acknowledge";

async function postV2(body: Record<string, unknown>): Promise<V2Response> {
  const response = await fetch("/api/public-booking/v2", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  if (!response.ok) {
    const rawRetry = response.headers.get("retry-after");
    const retryAfter = rawRetry && /^[1-9][0-9]{0,3}$/.test(rawRetry) ? Number(rawRetry) : 30;
    throw new V2RequestError(response.status, response.status === 429 ? Math.min(retryAfter, 3600) : 0,
      typeof body.action === "string" ? body.action : undefined);
  }
  return response.json() as Promise<V2Response>;
}

function validConfirmation(value: unknown, requestedStart: string): value is Confirmation {
  if (!value || typeof value !== "object") return false;
  const confirmation = value as Partial<Confirmation>;
  const start = typeof confirmation.confirmed_start === "string" ? Date.parse(confirmation.confirmed_start) : NaN;
  const end = typeof confirmation.confirmed_end === "string" ? Date.parse(confirmation.confirmed_end) : NaN;
  return typeof confirmation.appointment_id === "string"
    && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(confirmation.appointment_id)
    && Number.isFinite(start) && start === Date.parse(requestedStart)
    && Number.isFinite(end) && end > start;
}

type Props = {
  locale: Locale;
  salon: { name: string; slug: string; city: string | null; countryCode: string; currency: string; timeZone: string; defaultLocale?: Locale };
  services: Service[];
  bookingStaffByService?: Record<string, Array<{ id: string; name: string }>>;
  initialServiceId?: string;
  sandbox?: boolean;
  v2?: boolean;
};

const copy = {
  fr: {
    title: "Réservez votre rendez-vous",
    subtitle: "Choisissez une prestation, une date et un créneau disponible.",
    service: "Prestation",
    date: "Date",
    staff: "Professionnel",
    anyStaff: "Sans préférence : un professionnel disponible",
    preferredStaffUnavailable: "Aucun créneau pour ce professionnel à cette date.",
    showAllStaff: "Voir tous les professionnels",
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
    uncertain: "Votre réservation a peut-être été enregistrée. Ne choisissez pas un autre créneau avant de vérifier celle-ci.",
    uncertainHelp: "Gardez cette page ouverte et réessayez la même demande. Si elle n’a pas été enregistrée, cette action peut créer le rendez-vous. Sans confirmation, contactez le salon avant de réserver à nouveau.",
    checkOriginal: "Réessayer la demande initiale",
    legacyCutoverWarning: "Cette page de réservation ne peut plus envoyer de demandes. Votre demande initiale a peut-être été enregistrée.",
    legacyCutoverHelp: "Contactez le salon pour vérifier cette demande avant de réserver à nouveau. Ne choisissez pas un autre créneau ici.",
    v2CheckOriginal: "Vérifier la demande initiale",
    v2CheckHelp: "La vérification ne crée pas de rendez-vous. Vous ne pouvez pas choisir un autre créneau tant que le résultat de cette demande n’est pas établi.",
    v2Finish: "Terminer la réservation initiale",
    v2FinishHelp: "La dernière vérification indiquait une demande en attente. Vérifiez les détails ci-dessous. Nous vérifierons encore avant de créer le rendez-vous initial.",
    v2FinishSummary: "Rendez-vous initial à terminer",
    v2DisplayedPrice: "Tarif affiché au début de cette demande",
    v2DisplayedPriceNote: "Ce tarif n’est pas garanti. Confirmez le montant final avec le salon.",
    v2PreparedNoSummary: "Les détails initiaux ne sont plus disponibles dans cet onglet. Vérifiez ou annulez la demande, ou contactez le salon. Aucun rendez-vous ne sera créé automatiquement.",
    v2Loading: "Vérification des réservations de ce navigateur…",
    v2Manual: "La session de réservation de ce navigateur a été perdue. Contactez le salon avant de réserver à nouveau.",
    v2Inactive: "Ce rendez-vous n’est plus actif. Contactez le salon avant de réserver à nouveau.",
    v2NotCommitted: "La demande précédente n’a pas été enregistrée. Vous pouvez choisir un nouveau créneau.",
    v2Cancel: "Annuler cette demande si elle n’a pas été enregistrée",
    v2CancelHelp: "Si la réservation a déjà été enregistrée, sa confirmation s’affichera à la place.",
    v2CancelPending: "L’annulation n’est pas confirmée. Réessayez l’annulation de cette demande avant de réserver à nouveau.",
    v2PreparedPending: "La demande est encore en attente. Vérifiez-la ou annulez-la; elle ne sera pas réservée automatiquement.",
    v2AgainError: "Impossible d’ouvrir une nouvelle demande. Réessayez ou contactez le salon.",
    v2AgainRateLimited: "Trop de demandes. Attendez avant d’ouvrir une nouvelle réservation.",
    v2RateLimited: "Trop de demandes de réservation. Attendez avant de réessayer la même demande.",
    v2Unavailable: "La vérification des réservations est momentanément indisponible. Réessayez sans choisir un autre créneau.",
    v2StartupHelp: "Aucune nouvelle réservation n’a été envoyée depuis cette page. Réessayez pour vérifier la session de ce navigateur.",
    success: "Rendez-vous confirmé",
    confirmation: "Votre rendez-vous est enregistré dans l’agenda du salon.",
    salon: "Salon",
    address: "Adresse",
    serviceMissing: "Détails de la prestation indisponibles. Contactez le salon.",
    addressMissing: "Adresse non publiée. Contactez le salon pour confirmer le lieu du rendez-vous.",
    policies: "Conditions du salon et annulation",
    policiesMissing: "Conditions d’annulation non publiées. Contactez le salon pour les connaître.",
    price: "Tarif actuel de la prestation",
    priceNote: "Confirmez le montant final et les modalités de paiement avec le salon.",
    priceMissing: "Tarif indisponible. Contactez le salon pour le confirmer.",
    payment: "Paiement",
    noOnlinePayment: "Aucun paiement en ligne n’a été encaissé lors de cette réservation.",
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
    preferredStaffUnavailable: "This professional has no times on this date.",
    showAllStaff: "Show all professionals",
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
    uncertain: "Your booking may have succeeded. Do not choose another time until this request is checked.",
    uncertainHelp: "Keep this page open and retry the same request. If it was not saved, retrying may create the booking. Without confirmation, contact the salon before booking again.",
    checkOriginal: "Retry original request",
    legacyCutoverWarning: "This booking page can no longer submit requests. Your original request may have been saved.",
    legacyCutoverHelp: "Contact the salon to verify this request before booking again. Do not choose another time here.",
    v2CheckOriginal: "Check original request",
    v2CheckHelp: "Checking does not create an appointment. You cannot choose another time until this request’s outcome is known.",
    v2Finish: "Finish the original booking",
    v2FinishHelp: "The last check found this request pending. Review the details below. We will check again before creating the original appointment.",
    v2FinishSummary: "Original booking to finish",
    v2DisplayedPrice: "Price shown when this request began",
    v2DisplayedPriceNote: "This is not a guaranteed quote. Confirm the final amount with the salon.",
    v2PreparedNoSummary: "The original details are no longer available in this tab. Check or cancel the request, or contact the salon. No appointment will be created automatically.",
    v2Loading: "Checking this browser’s booking attempts…",
    v2Manual: "This browser’s booking session was lost. Contact the salon before booking again.",
    v2Inactive: "This appointment is no longer active. Contact the salon before booking again.",
    v2NotCommitted: "The previous request was not booked. You may choose a new time.",
    v2Cancel: "Cancel this request if it was not booked",
    v2CancelHelp: "If the booking was already saved, its confirmation will appear instead.",
    v2CancelPending: "Cancellation is not confirmed. Retry canceling this request before booking again.",
    v2PreparedPending: "This request is still pending. Check or cancel it; it will not be booked automatically.",
    v2AgainError: "A new request could not be opened. Try again or contact the salon.",
    v2AgainRateLimited: "Too many requests. Wait before opening another booking.",
    v2RateLimited: "Too many booking requests. Wait before checking the same request again.",
    v2Unavailable: "Booking recovery is temporarily unavailable. Try again without choosing another time.",
    v2StartupHelp: "No new booking was sent from this page. Retry to check this browser session.",
    success: "Appointment confirmed",
    confirmation: "Your appointment is saved in the salon calendar.",
    salon: "Salon",
    address: "Address",
    serviceMissing: "Service details unavailable. Contact the salon.",
    addressMissing: "Address not published. Contact the salon to confirm your appointment location.",
    policies: "Salon and cancellation policies",
    policiesMissing: "Cancellation policies are not published. Contact the salon for details.",
    price: "Current service price",
    priceNote: "Confirm the final amount and payment arrangements with the salon.",
    priceMissing: "Price unavailable. Contact the salon to confirm it.",
    payment: "Payment",
    noOnlinePayment: "No online payment was collected during this booking.",
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
    preferredStaffUnavailable: "Este profesional no tiene horarios para esta fecha.",
    showAllStaff: "Ver todos los profesionales",
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
    uncertain: "Es posible que tu reserva se haya registrado. No elijas otra hora hasta comprobar esta solicitud.",
    uncertainHelp: "Mantén esta página abierta y reintenta la misma solicitud. Si no se guardó, el reintento puede crear la reserva. Sin confirmación, contacta con el salón antes de reservar de nuevo.",
    checkOriginal: "Reintentar la solicitud original",
    legacyCutoverWarning: "Esta página de reservas ya no puede enviar solicitudes. Es posible que se haya guardado tu solicitud original.",
    legacyCutoverHelp: "Contacta con el salón para comprobar esta solicitud antes de volver a reservar. No elijas otra hora aquí.",
    v2CheckOriginal: "Comprobar la solicitud original",
    v2CheckHelp: "La comprobación no crea una cita. No puedes elegir otra hora hasta que se conozca el resultado de esta solicitud.",
    v2Finish: "Completar la reserva original",
    v2FinishHelp: "La última comprobación encontró esta solicitud pendiente. Revisa los detalles. Comprobaremos de nuevo antes de crear la cita original.",
    v2FinishSummary: "Reserva original por completar",
    v2DisplayedPrice: "Precio mostrado al iniciar esta solicitud",
    v2DisplayedPriceNote: "Este precio no está garantizado. Confirma el importe final con el salón.",
    v2PreparedNoSummary: "Los detalles originales ya no están disponibles en esta pestaña. Comprueba o cancela la solicitud, o contacta con el salón. No se creará una cita automáticamente.",
    v2Loading: "Comprobando las reservas de este navegador…",
    v2Manual: "Se perdió la sesión de reserva de este navegador. Contacta con el salón antes de reservar de nuevo.",
    v2Inactive: "Esta cita ya no está activa. Contacta con el salón antes de reservar de nuevo.",
    v2NotCommitted: "La solicitud anterior no se reservó. Puedes elegir otra hora.",
    v2Cancel: "Cancelar esta solicitud si no se reservó",
    v2CancelHelp: "Si la reserva ya se guardó, se mostrará su confirmación.",
    v2CancelPending: "La cancelación no está confirmada. Vuelve a cancelar esta solicitud antes de reservar otra cita.",
    v2PreparedPending: "Esta solicitud sigue pendiente. Compruébala o cancélala; no se reservará automáticamente.",
    v2AgainError: "No se pudo abrir una nueva solicitud. Reinténtalo o contacta con el salón.",
    v2AgainRateLimited: "Demasiadas solicitudes. Espera antes de abrir otra reserva.",
    v2RateLimited: "Hay demasiadas solicitudes de reserva. Espera antes de comprobar la misma solicitud.",
    v2Unavailable: "La recuperación de reservas no está disponible temporalmente. Reinténtalo sin elegir otra hora.",
    v2StartupHelp: "No se ha enviado ninguna reserva nueva desde esta página. Reintenta comprobar la sesión de este navegador.",
    success: "Cita confirmada",
    confirmation: "Tu cita está guardada en el calendario del salón.",
    salon: "Salón",
    address: "Dirección",
    serviceMissing: "Detalles del servicio no disponibles. Contacta con el salón.",
    addressMissing: "Dirección no publicada. Contacta con el salón para confirmar el lugar de la cita.",
    policies: "Condiciones del salón y cancelación",
    policiesMissing: "Las condiciones de cancelación no están publicadas. Contacta con el salón para conocerlas.",
    price: "Precio actual del servicio",
    priceNote: "Confirma el importe final y las condiciones de pago con el salón.",
    priceMissing: "Precio no disponible. Contacta con el salón para confirmarlo.",
    payment: "Pago",
    noOnlinePayment: "No se ha cobrado ningún pago en línea durante esta reserva.",
    reference: "Referencia",
    another: "Reservar otra cita",
    duration: "Duración",
    deposit: "Depósito",
  },
} as const;

function localizedServiceTitle(values: Record<string, string> | null | undefined, locale: Locale, countryDefaultLocale: Locale) {
  for (const language of [locale, countryDefaultLocale, "fr", "en", "es"]) {
    const title = values?.[language];
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  return copy[locale].serviceMissing;
}

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

function availableTimes(slots: Slot[], preferredStaffId: string) {
  if (preferredStaffId) return slots.filter((value) => value.staff_id === preferredStaffId);
  const unique = new Map<string, Slot>();
  for (const value of slots) if (!unique.has(value.slot_start)) unique.set(value.slot_start, value);
  return [...unique.values()];
}

export function LiveBookingFlow({ locale, salon, services, bookingStaffByService = {}, initialServiceId, sandbox = false, v2 = false }: Props) {
  if (!services.length || (initialServiceId !== undefined && !services.some((service) => service.id === initialServiceId))) {
    throw new Error("Booking requires a service from this salon's catalog.");
  }
  const labels = copy[locale];
  const countryDefaultLocale = salon.defaultLocale ?? "fr";
  const paymentLabels = sandboxPaymentCopy[locale];
  const retry = useRef<{ payload: BookingPayload; key: string } | null>(null);
  const legacyCutoverManualRef = useRef(false);
  const inFlight = useRef(false);
  const uncertainRef = useRef(false);
  const contactRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  const recoveryRef = useRef<HTMLHeadingElement>(null);
  const preparedOfferRef = useRef<HTMLHeadingElement>(null);
  const v2Intent = useRef<string | null>(null);
  const v2OriginalPrepared = useRef<V2OriginalPrepared | null>(null);
  const v2Generation = useRef<string | null>(null);
  const v2Attempted = useRef(false);
  const v2Acknowledged = useRef(false);
  const v2Bootstrap = useRef<Promise<V2Response> | null>(null);
  const v2ActionCooldownRef = useRef<Partial<Record<V2CapabilityAction, true>>>({});
  const v2ActionTimers = useRef<Partial<Record<V2CapabilityAction, number>>>({});
  const today = useMemo(() => dateInZone(salon.timeZone), [salon.timeZone]);
  // Do not accept a native selection before React can persist it to booking state.
  const hydrated = useSyncExternalStore(noHydrationSubscription, () => true, () => false);
  const [serviceId, setServiceId] = useState(initialServiceId ?? services[0].id);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [uncertainPublicBooking, setUncertainPublicBooking] = useState(false);
  const [legacyCutoverManual, setLegacyCutoverManual] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [availabilityFailed, setAvailabilityFailed] = useState(false);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [preferredStaffId, setPreferredStaffId] = useState("");
  const [v2Phase, setV2Phase] = useState<"loading" | "ready">(v2 ? "loading" : "ready");
  const [v2StartupError, setV2StartupError] = useState<"rate_limited" | "unavailable" | null>(null);
  const [v2RetrySeconds, setV2RetrySeconds] = useState(0);
  const [v2ActionCooldown, setV2ActionCooldown] = useState<Partial<Record<V2CapabilityAction, true>>>({});
  const [v2RetryNonce, setV2RetryNonce] = useState(0);
  const [v2ManualOnly, setV2ManualOnly] = useState(false);
  const [v2Warning, setV2Warning] = useState("");
  const [v2PreparedOffer, setV2PreparedOffer] = useState<V2OriginalPrepared | null>(null);
  const [v2AgainError, setV2AgainError] = useState(false);
  const service = services.find((item) => item.id === serviceId) ?? services[0];
  const staffChoices = bookingStaffByService[serviceId] ?? [];
  const visibleSlots = availableTimes(slots, preferredStaffId);
  // The intent UUID is not a bearer capability without the independent
  // HttpOnly cookie. Per-intent keys prevent a delayed old-tab response from
  // erasing a newer tab's pending marker.
  const markerPrefix = `glowflow.booking.pending.${salon.slug}.`;
  // Separate key: writing a pending marker can never overwrite a cancel choice.
  const cancelMarkerPrefix = `glowflow.booking.cancel.${salon.slug}.`;

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
        setSlots(values);
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

  useEffect(() => {
    if (uncertainPublicBooking) recoveryRef.current?.focus();
  }, [uncertainPublicBooking, legacyCutoverManual]);

  useEffect(() => {
    if (v2PreparedOffer) preparedOfferRef.current?.focus();
  }, [v2PreparedOffer]);

  useEffect(() => {
    if (v2RetrySeconds <= 0) return;
    const timer = window.setTimeout(() => setV2RetrySeconds(0), v2RetrySeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [v2RetrySeconds]);

  useEffect(() => {
    const timers = v2ActionTimers.current;
    return () => { for (const timer of Object.values(timers)) window.clearTimeout(timer); };
  }, []);

  function actionCoolingDown(action: V2CapabilityAction): boolean {
    return v2ActionCooldownRef.current[action] === true;
  }

  function recordActionRetry(action: V2CapabilityAction, seconds: number) {
    const prior = v2ActionTimers.current[action];
    if (prior !== undefined) window.clearTimeout(prior);
    const next = { ...v2ActionCooldownRef.current, [action]: true as const };
    v2ActionCooldownRef.current = next;
    setV2ActionCooldown(next);
    v2ActionTimers.current[action] = window.setTimeout(() => {
      const current = { ...v2ActionCooldownRef.current };
      delete current[action];
      v2ActionCooldownRef.current = current;
      setV2ActionCooldown(current);
      delete v2ActionTimers.current[action];
    }, seconds * 1000);
  }

  function pendingIntentIds(): string[] | null {
    try {
      const ids: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key?.startsWith(markerPrefix)) continue;
        const id = key.slice(markerPrefix.length);
        if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
          || window.localStorage.getItem(key) !== "1") return null;
        ids.push(id);
      }
      return ids;
    } catch { return null; }
  }

  function markPending(intentId: string): boolean {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(intentId)) return false;
    try { window.localStorage.setItem(`${markerPrefix}${intentId}`, "1"); return true; }
    catch { return false; }
  }

  function markCancelRequested(intentId: string): boolean {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(intentId)) return false;
    try { window.localStorage.setItem(`${cancelMarkerPrefix}${intentId}`, "1"); return true; }
    catch { return false; }
  }

  function cancelRequested(intentId: string): boolean | null {
    try {
      const value = window.localStorage.getItem(`${cancelMarkerPrefix}${intentId}`);
      return value === null ? false : value === "1" ? true : null;
    }
    catch { return null; }
  }

  function removeMarker(intentId: string): boolean {
    try {
      window.localStorage.removeItem(`${markerPrefix}${intentId}`);
      window.localStorage.removeItem(`${cancelMarkerPrefix}${intentId}`);
    }
    catch { return false; }
    return true;
  }

  function clearPending(intentId: string): boolean {
    if (!removeMarker(intentId)) return false;
    return pendingIntentIds()?.length === 0;
  }

  function lockV2(manualOnly = false, warning = "") {
    uncertainRef.current = true;
    setUncertainPublicBooking(true);
    setV2ManualOnly(manualOnly);
    setV2Warning(warning);
    setV2PreparedOffer(null);
    setV2Phase("ready");
  }

  function showPreparedV2(intentId: string, generation?: string) {
    const markers = pendingIntentIds();
    if (!markers || markers.length > 1 || (markers.length === 1 && markers[0] !== intentId)) {
      lockV2(true, labels.v2Manual);
      return;
    }
    const wantsCancel = cancelRequested(intentId);
    if (wantsCancel === null) { lockV2(true, labels.v2Manual); return; }
    lockV2(false, wantsCancel ? labels.v2CancelPending : labels.v2PreparedPending);
    const original = v2OriginalPrepared.current;
    if (!wantsCancel && markers.length === 1 && original?.intentId === intentId && original.generation === generation) {
      setV2PreparedOffer(original);
    }
  }

  function lockV2ForRequestFailure(reason: unknown, action?: "bootstrap" | "prepare" | "reconcile" | V2CapabilityAction) {
    // The v2 API uses 409 when the browser capability is absent or invalid.
    // Retrying with that same cookie cannot reconcile an earlier attempt.
    if (reason instanceof V2RequestError && reason.status === 429) {
      const deniedAction = reason.action ?? action;
      if (deniedAction === "commit" || deniedAction === "cancel" || deniedAction === "acknowledge") {
        recordActionRetry(deniedAction, reason.retryAfterSeconds);
      } else setV2RetrySeconds(reason.retryAfterSeconds);
      lockV2(false, labels.v2RateLimited);
    } else {
      setV2RetrySeconds(0);
      if (reason instanceof V2RequestError && reason.status === 409) lockV2(true, labels.v2Manual);
      else lockV2(false, reason instanceof V2RequestError && reason.status === 503 ? labels.v2Unavailable : "");
    }
  }

  function applyV2Result(result: V2Response, knownPending = v2Attempted.current, currentSnapshot = false) {
    setV2PreparedOffer(null);
    if (currentSnapshot) {
      if (!result.generation || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(result.generation)) {
        lockV2();
        return;
      }
      v2Generation.current = result.generation;
    }
    if (v2Intent.current && result.intent_id && result.intent_id !== v2Intent.current) {
      lockV2(true, labels.v2Manual);
      return;
    }
    if (result.intent_id && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(result.intent_id)) {
      v2Intent.current = result.intent_id;
    }
    if (result.state === "confirmed" && result.confirmation
      && validConfirmation(result.confirmation, result.confirmation.confirmed_start)) {
      const status = result.confirmation.appointment_status;
      if (status === "canceled" || status === "no_show") {
        lockV2(true, labels.v2Inactive);
        return;
      }
      if (status !== "confirmed" && status !== "completed") { lockV2(); return; }
      if (!result.intent_id || !clearPending(result.intent_id)) {
        lockV2(true, labels.v2Manual);
        return;
      }
      setConfirmation(result.confirmation);
      v2OriginalPrepared.current = null;
      uncertainRef.current = false;
      setUncertainPublicBooking(false);
      setV2Phase("ready");
      setV2ManualOnly(false);
      return;
    }
    if (result.state === "not_committed") {
      v2OriginalPrepared.current = null;
      if (!result.intent_id || !clearPending(result.intent_id)) {
        lockV2(true, labels.v2Manual);
        return;
      }
      if (!currentSnapshot) { lockV2(); return; }
      v2Intent.current = null;
      v2Attempted.current = false;
      uncertainRef.current = false;
      setUncertainPublicBooking(false);
      setV2ManualOnly(false);
      setV2Phase("ready");
      setError(labels.v2NotCommitted);
      reloadAvailability();
      return;
    }
    if (result.state === "none") {
      if (!currentSnapshot) { lockV2(); return; }
      if (!v2Generation.current) { lockV2(); return; }
      if (knownPending) { lockV2(true, labels.v2Manual); return; }
      v2Attempted.current = false;
      uncertainRef.current = false;
      setUncertainPublicBooking(false);
      setV2Phase("ready");
      return;
    }
    if (result.state === "prepared" && v2Intent.current) {
      showPreparedV2(v2Intent.current, result.generation);
      return;
    }
    lockV2();
  }

  async function reconcileCurrentV2() {
    const current = await postV2({ action: "reconcile", salonSlug: salon.slug });
    const outstanding = pendingIntentIds();
    if (!outstanding) { lockV2(true, labels.v2Manual); return current; }
    applyV2Result(current, outstanding.length > 0, true);
    return current;
  }

  async function handleV2Response(result: V2Response) {
    if (result.state !== "not_committed") { applyV2Result(result, true); return; }
    if (!result.intent_id || (v2Intent.current && result.intent_id !== v2Intent.current)
      || !removeMarker(result.intent_id)) { lockV2(true, labels.v2Manual); return; }
    v2Intent.current = null;
    const current = await reconcileCurrentV2();
    if (current.state === "none" && !uncertainRef.current) {
      v2Attempted.current = false;
      setError(labels.v2NotCommitted);
      reloadAvailability();
    }
  }

  useEffect(() => {
    if (!v2 || sandbox) return;
    let active = true;
    void (async () => {
    let stage: "bootstrap" | "reconcile" = "bootstrap";
    const markers = pendingIntentIds();
    if (!markers) { if (active) lockV2(true, labels.v2Manual); return; }
    const hadMarker = markers.length > 0;
      if (!v2Bootstrap.current) v2Bootstrap.current = postV2({ action: "bootstrap" });
      try {
        const boot = await v2Bootstrap.current;
        if (!active) return;
        if (boot?.ready !== true) throw new Error("bootstrap_failed");
        if (hadMarker && boot.new_session) { lockV2(true, labels.v2Manual); return; }
        stage = "reconcile";
        const confirmed: V2Response[] = [];
        const prepared: V2Response[] = [];
        for (const intentId of markers) {
          const result = await postV2({ action: "reconcile", salonSlug: salon.slug, intentId });
          if (!active) return;
          if (result.intent_id !== intentId) { lockV2(true, labels.v2Manual); return; }
          if (result.state === "confirmed") { confirmed.push(result); continue; }
          if (result.state === "prepared") { prepared.push(result); continue; }
          if (result.state === "not_committed" && !removeMarker(intentId)) {
            lockV2(true, labels.v2Manual);
            return;
          }
          if (result.state !== "not_committed") {
            lockV2(true, labels.v2Manual);
            return;
          }
        }
        if (confirmed.length > 1 || prepared.length > 1 || (confirmed.length && prepared.length)) {
          lockV2(true, labels.v2Manual);
          return;
        }
        if (confirmed.length === 1) { applyV2Result(confirmed[0], true); return; }
        if (prepared.length === 1) {
          applyV2Result(prepared[0], true);
          return;
        }
        const result = await postV2({ action: "reconcile", salonSlug: salon.slug });
        if (active) applyV2Result(result, (pendingIntentIds()?.length ?? 1) > 0, true);
      } catch (reason) {
        if (!active) return;
        v2Bootstrap.current = null;
        if (stage === "bootstrap" && !hadMarker
          && !(reason instanceof V2RequestError && reason.status === 409)) {
          setV2StartupError(reason instanceof V2RequestError && reason.status === 429 ? "rate_limited" : "unavailable");
          setV2RetrySeconds(reason instanceof V2RequestError && reason.status === 429 ? reason.retryAfterSeconds : 0);
          setV2Phase("ready");
        } else lockV2ForRequestFailure(reason);
      }
    })();
    return () => { active = false; };
    // Bootstrap is intentionally once per mounted booking page, including Strict Mode replays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v2, sandbox, salon.slug, v2RetryNonce]);

  function retryV2Startup() {
    if (!v2StartupError || v2RetrySeconds > 0 || inFlight.current) return;
    v2Bootstrap.current = null;
    setV2StartupError(null);
    setV2Phase("loading");
    setV2RetryNonce((value) => value + 1);
  }

  function reloadAvailability() {
    setSlot(null);
    setSlots([]);
    setLoadingSlots(true);
    setAvailabilityFailed(false);
    setAvailabilityVersion((value) => value + 1);
  }

  async function sendBooking(payload: BookingPayload, requestKey: string) {
    if (inFlight.current || (!sandbox && legacyCutoverManualRef.current)) return;
    const wasUncertain = uncertainRef.current;
    inFlight.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(sandbox ? "/api/checkout" : "/api/public-booking", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, requestKey }),
      });
      const result = await response.json() as { confirmation?: Confirmation; error?: string; url?: string; reservationId?: string };

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

      if (response.status === 410 && result.error === "booking_contract_changed") {
        // A later 410 cannot prove whether an earlier lost response committed.
        // Preserve the exact original key/payload, but never retry this closed
        // legacy contract or let the visitor create a changed booking here.
        legacyCutoverManualRef.current = true;
        setLegacyCutoverManual(true);
        uncertainRef.current = true;
        setUncertainPublicBooking(true);
        setError("");
        return;
      }

      if (!response.ok || !validConfirmation(result.confirmation, payload.startTime)) {
        const conflict = response.status === 409 && result.error === "slot_unavailable";
        const invalid = response.status === 400 && result.error === "invalid_request";
        if ((conflict || invalid) && !wasUncertain) {
          retry.current = null;
          uncertainRef.current = false;
          setUncertainPublicBooking(false);
          setError(conflict ? labels.conflict : labels.error);
          if (conflict) reloadAvailability();
          setSlot(null);
        } else {
          // Once uncertain, even a later 400/409 cannot prove the original
          // request will not arrive and commit after this retry.
          // Keep the exact original payload and key until a valid confirmation.
          uncertainRef.current = true;
          setUncertainPublicBooking(true);
          setError(labels.uncertain);
        }
        return;
      }
      setConfirmation(result.confirmation);
      retry.current = null;
      uncertainRef.current = false;
      setUncertainPublicBooking(false);
      setError("");
    } catch {
      if (sandbox) setError(paymentLabels.unavailable);
      else {
        uncertainRef.current = true;
        setUncertainPublicBooking(true);
        setError(labels.uncertain);
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function submitV2(payload: BookingPayload) {
    if (!v2Generation.current) { lockV2(); return; }
    v2Attempted.current = true;
    v2OriginalPrepared.current = null;
    lockV2();
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    let stage: "prepare" | "commit" = "prepare";
    try {
      const prepared = await postV2({ action: "prepare", ...payload, expectedGeneration: v2Generation.current });
      if (prepared.state !== "prepared" || !prepared.intent_id) {
        await handleV2Response(prepared);
        return;
      }
      v2Intent.current = prepared.intent_id;
      const originalService = services.find((item) => item.id === payload.serviceId);
      const originalStaff = bookingStaffByService[payload.serviceId]?.find((item) => item.id === payload.staffId);
      if (originalService && originalStaff && prepared.generation === v2Generation.current) {
        v2OriginalPrepared.current = {
          intentId: prepared.intent_id, generation: prepared.generation!,
          serviceId: payload.serviceId, staffId: payload.staffId, startTime: payload.startTime,
          serviceTitle: localizedServiceTitle(originalService.title_json, locale, countryDefaultLocale),
          staffName: originalStaff.name, salonName: salon.name, timeZone: salon.timeZone,
          displayedPrice: originalService.price, currency: originalService.currency,
        };
      }
      // Preparation cannot book. Before the first appointment-creating POST,
      // persist only a non-contact intent marker so a lost cookie fails closed.
      if (!markPending(prepared.intent_id)) { v2OriginalPrepared.current = null; lockV2(true, labels.v2Manual); return; }
      const wantsCancel = cancelRequested(prepared.intent_id);
      if (wantsCancel !== false) {
        lockV2(wantsCancel === null, wantsCancel === null ? labels.v2Manual : labels.v2CancelPending);
        return;
      }
      stage = "commit";
      const committed = await postV2({ action: "commit", salonSlug: salon.slug, intentId: prepared.intent_id });
      await handleV2Response(committed);
    } catch (reason) { lockV2ForRequestFailure(reason, stage); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  async function recoverV2() {
    if (v2ManualOnly || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    let stage: "bootstrap" | "reconcile" = "reconcile";
    try {
      let intentId = v2Intent.current;
      if (!intentId) {
        const markers = pendingIntentIds();
        if (!markers || markers.length > 1) { lockV2(true, labels.v2Manual); return; }
        if (markers.length === 1) {
          // A transient initial reconcile failure after reload must retain
          // the exact marker and retry only that intent, never a new prepare.
          intentId = markers[0];
        } else {
          // A failed bootstrap or terminal follow-up may leave no exact intent
          // in this mounted page. Only a fresh current-session snapshot can
          // authorize the form again; an exact old terminal generation cannot.
          stage = "bootstrap";
          const boot = await postV2({ action: "bootstrap" });
          if (boot.ready !== true) throw new Error("bootstrap_failed");
          stage = "reconcile";
          const current = await postV2({ action: "reconcile", salonSlug: salon.slug });
          applyV2Result(current, false, true);
          return;
        }
      }
      const reconciled = await postV2({
        action: "reconcile", salonSlug: salon.slug,
        intentId,
      });
      if (reconciled.intent_id && reconciled.intent_id !== intentId) {
        lockV2(true, labels.v2Manual);
        return;
      }
      if (reconciled.state !== "prepared" || !reconciled.intent_id) {
        await handleV2Response(reconciled);
        return;
      }
      v2Intent.current = reconciled.intent_id;
      // A recovered prepared intent is ambiguous across tabs and reloads.
      // Recovery never commits automatically. Only a separate, explicit choice
      // in this mounted tab may finish its original prepared intent.
      showPreparedV2(reconciled.intent_id, reconciled.generation);
    } catch (reason) { lockV2ForRequestFailure(reason, stage); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  async function cancelV2() {
    if (!v2Intent.current || v2ManualOnly || actionCoolingDown("cancel") || inFlight.current) return;
    v2OriginalPrepared.current = null;
    setV2PreparedOffer(null);
    if (!markCancelRequested(v2Intent.current)) { lockV2(true, labels.v2Manual); return; }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const result = await postV2({ action: "cancel", salonSlug: salon.slug, intentId: v2Intent.current });
      await handleV2Response(result);
    } catch (reason) { lockV2ForRequestFailure(reason, "cancel"); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  async function finishPreparedV2() {
    const original = v2PreparedOffer;
    if (!original || original !== v2OriginalPrepared.current || v2Intent.current !== original.intentId
      || v2ManualOnly || actionCoolingDown("commit") || v2RetrySeconds > 0 || inFlight.current) return;
    const markers = pendingIntentIds();
    if (!markers || markers.length !== 1 || markers[0] !== original.intentId
      || !markPending(original.intentId)) { lockV2(true, labels.v2Manual); return; }
    const choice = cancelRequested(original.intentId);
    if (choice !== false) {
      lockV2(choice === null, choice === null ? labels.v2Manual : labels.v2CancelPending);
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setV2PreparedOffer(null);
    let stage: "reconcile" | "commit" = "reconcile";
    try {
      const current = await postV2({ action: "reconcile", salonSlug: salon.slug, intentId: original.intentId });
      if (current.intent_id !== original.intentId) { lockV2(true, labels.v2Manual); return; }
      if (current.state !== "prepared" || current.generation !== original.generation) {
        await handleV2Response(current);
        return;
      }
      const exactMarkers = pendingIntentIds();
      if (v2Intent.current !== original.intentId || v2OriginalPrepared.current !== original
        || !exactMarkers || exactMarkers.length !== 1 || exactMarkers[0] !== original.intentId
        || !markPending(original.intentId)) { lockV2(true, labels.v2Manual); return; }
      const latestChoice = cancelRequested(original.intentId);
      if (latestChoice !== false) {
        lockV2(latestChoice === null, latestChoice === null ? labels.v2Manual : labels.v2CancelPending);
        return;
      }
      if (actionCoolingDown("commit")) { lockV2(false, labels.v2RateLimited); return; }
      stage = "commit";
      const committed = await postV2({ action: "commit", salonSlug: salon.slug, intentId: original.intentId });
      await handleV2Response(committed);
    } catch (reason) { lockV2ForRequestFailure(reason, stage); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  async function anotherBooking() {
    if (!v2) { setConfirmation(null); reloadAvailability(); return; }
    if (!v2Intent.current || actionCoolingDown("acknowledge") || v2RetrySeconds > 0 || inFlight.current) return;
    inFlight.current = true;
    setV2AgainError(false);
    try {
      if (!v2Acknowledged.current) {
        const result = await postV2({ action: "acknowledge", salonSlug: salon.slug, intentId: v2Intent.current });
        if (result.state !== "none" || !result.generation
          || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(result.generation)) throw new Error("acknowledgement_unresolved");
        v2Acknowledged.current = true;
      }
      if (pendingIntentIds()?.length !== 0) throw new Error("another_attempt_unresolved");
      const current = await postV2({ action: "reconcile", salonSlug: salon.slug });
      if (current.state !== "none" || !current.generation
        || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(current.generation)) throw new Error("current_generation_unavailable");
      v2Generation.current = current.generation;
      v2Intent.current = null;
      v2Attempted.current = false;
      v2Acknowledged.current = false;
      setConfirmation(null);
      reloadAvailability();
    } catch (reason) {
      if (reason instanceof V2RequestError && reason.status === 429) {
        if (reason.action === "acknowledge") recordActionRetry("acknowledge", reason.retryAfterSeconds);
        else setV2RetrySeconds(reason.retryAfterSeconds);
      }
      setV2AgainError(true);
    }
    finally { inFlight.current = false; }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uncertainRef.current || (v2 && (v2Phase !== "ready" || v2StartupError)) || !slot || loadingSlots || inFlight.current) return;
    const form = new FormData(event.currentTarget);
    const fullName = String(form.get("fullName") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    if (!phone && !email) {
      setError(labels.contact);
      contactRef.current?.focus();
      return;
    }

    const payload: BookingPayload = { salonSlug: salon.slug, serviceId, staffId: slot.staff_id, startTime: slot.slot_start, fullName, phone, email, locale };
    if (v2) { await submitV2(payload); return; }
    if (!retry.current || JSON.stringify(retry.current.payload) !== JSON.stringify(payload)) {
      retry.current = { payload, key: crypto.randomUUID() };
    }
    await sendBooking(retry.current.payload, retry.current.key);
  }

  async function retryOriginalBooking() {
    if (v2) { await recoverV2(); return; }
    if (!uncertainPublicBooking || legacyCutoverManualRef.current || !retry.current || inFlight.current) return;
    await sendBooking(retry.current.payload, retry.current.key);
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: confirmation?.details?.time_zone ?? salon.timeZone, dateStyle: "full", timeStyle: "short",
  });

  if (confirmation) {
    const details = confirmation.details;
    // V1's top-level title may reflect a modified idempotent retry when
    // enrichment fails; only v2 binds that title to the immutable intent.
    const title = details?.service_title ?? (v2 ? confirmation.service_title : undefined);
    const policyLocale = ([locale, "fr", "en", "es"] as const).find((language) => typeof details?.policies?.[language] === "string" && details.policies[language].trim());
    const policy = policyLocale ? details?.policies?.[policyLocale] : null;
    const hasPrice = details?.catalog_price != null && Number.isSafeInteger(details.catalog_price) && details.catalog_price >= 0 && details.currency && ["EUR", "USD"].includes(details.currency);
    return <main className="grid min-h-screen place-items-center bg-[#f3ece2] p-4 text-slate-950 dark:bg-[#101216] dark:text-stone-50">
      <section className="w-full max-w-xl rounded-[2rem] border border-[#e4d6c5] bg-[#faf9f6] p-7 text-center shadow-[0_24px_80px_rgba(48,32,18,0.12)] dark:border-white/10 dark:bg-[#17191e] sm:p-10">
        <span className="mx-auto grid size-20 place-items-center rounded-[1.75rem] bg-emerald-100 text-emerald-700"><CheckCircle2 className="size-10" /></span>
        <h1 ref={confirmationRef} tabIndex={-1} className="mt-6 text-3xl font-semibold tracking-[-0.045em]">{labels.success}</h1>
        <p className="mt-3 text-slate-600 dark:text-stone-300">{labels.confirmation}</p>
        <div className="mt-7 rounded-2xl border border-[#e8ded1] bg-white p-5 text-left dark:border-white/10 dark:bg-white/5">
          <p className="font-semibold">{localizedServiceTitle(title, locale, countryDefaultLocale)}</p>
          <p className="mt-2 text-sm">{formatter.format(new Date(confirmation.confirmed_start))} – {formatter.format(new Date(confirmation.confirmed_end))}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-stone-300">{labels.timeZone}: {details?.time_zone ?? salon.timeZone}</p>
          <dl className="mt-5 space-y-4 text-sm">
            <div><dt className="font-semibold">{labels.salon}</dt><dd className="mt-1">{confirmation.salon_name || salon.name}</dd></div>
            <div><dt className="font-semibold">{labels.address}</dt><dd className="mt-1 whitespace-pre-line">{details?.address || labels.addressMissing}</dd></div>
            <div><dt className="font-semibold">{labels.price}</dt><dd className="mt-1">{hasPrice ? `${money(details!.catalog_price!, details!.currency!, locale)} (${details!.currency})` : labels.priceMissing}</dd><dd className="mt-1 text-slate-600 dark:text-stone-300">{labels.priceNote}</dd></div>
            <div><dt className="font-semibold">{labels.payment}</dt><dd className="mt-1">{labels.noOnlinePayment}</dd></div>
            <div><dt className="font-semibold">{labels.policies}</dt><dd lang={policy ? policyLocale : locale} className="mt-1 whitespace-pre-line">{policy || labels.policiesMissing}</dd></div>
          </dl>
          <p className="mt-4 border-t border-[#eee5da] pt-4 text-xs text-slate-500">{labels.reference}: {confirmation.appointment_id}</p>
        </div>
        {v2AgainError ? <p role="alert" className="mt-4 text-sm font-semibold text-rose-700 dark:text-rose-300">{v2ActionCooldown.acknowledge || v2RetrySeconds > 0 ? labels.v2AgainRateLimited : labels.v2AgainError}</p> : null}
        <button type="button" disabled={Boolean(v2ActionCooldown.acknowledge) || v2RetrySeconds > 0} onClick={anotherBooking} className="mt-6 min-h-12 rounded-full border border-[#d9c7b2] px-6 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:opacity-45 dark:focus-visible:outline-white">{labels.another}</button>
      </section>
    </main>;
  }

  const contactError = error === labels.contact;
  const locked = uncertainPublicBooking || (v2 && (v2Phase === "loading" || v2StartupError !== null));

  return <main className="min-h-screen bg-[#f3ece2] p-3 text-slate-950 dark:bg-[#101216] dark:text-stone-50 sm:p-6">
    <div className="mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-[#faf9f6] shadow-[0_32px_100px_rgba(48,32,18,0.12)] dark:bg-[#17191e]">
      <header className="flex items-center justify-between bg-slate-950 px-5 py-4 text-white sm:px-8">
        {locked ? <span className="flex items-center gap-2 font-semibold"><Sparkles className="size-5 text-[#e7b779]" />GlowFlow</span>
          : <Link href={`/${locale}`} className="flex items-center gap-2 font-semibold"><Sparkles className="size-5 text-[#e7b779]" />GlowFlow</Link>}
        {locked ? <span className="text-sm font-semibold">{locale.toUpperCase()}</span> : <LanguageSwitcher locale={locale} />}
      </header>
      <div className="grid lg:grid-cols-[0.75fr_1.25fr]">
        <aside className="bg-[#eadbc9] p-6 dark:bg-white/5 sm:p-9">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#9a622f]">{salon.name}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">{sandbox ? paymentLabels.title : labels.title}</h1>
          {sandbox ? <p role="note" className="mt-4 rounded-xl bg-white/70 p-4 text-sm dark:bg-black/15">{paymentLabels.notice}</p> : null}
          <p className="mt-3 leading-7 text-slate-600 dark:text-stone-300">{labels.subtitle}</p>
          <p className="mt-6 flex items-center gap-2 text-sm"><MapPin className="size-4 text-[#9a622f]" />{salon.city ? `${salon.city}, ` : ""}{salon.countryCode}</p>
          <div className="mt-8 rounded-2xl bg-white/70 p-5 dark:bg-black/15">
            <p className="font-semibold">{localizedServiceTitle(service.title_json, locale, countryDefaultLocale)}</p>
            <p className="mt-2 text-sm text-slate-600 dark:text-stone-300">{labels.duration}: {service.duration_minutes} min</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-stone-300">{labels.deposit}: {money(service.deposit_amount, service.currency, locale)}</p>
            <p className="mt-4 text-2xl font-semibold">{money(service.price, service.currency, locale)}</p>
          </div>
        </aside>
        <form onSubmit={submit} aria-busy={submitting} className="space-y-7 p-6 sm:p-9">
          {v2 && v2Phase === "loading" ? <section role="status" className="rounded-2xl border border-[#dfd2c1] p-5">
            <h2 className="text-xl font-semibold">{labels.v2Loading}</h2>
          </section> : v2 && v2StartupError ? <section role="status" className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-50">
            <h2 className="text-xl font-semibold">{v2StartupError === "rate_limited" ? labels.v2RateLimited : labels.v2Unavailable}</h2>
            <p className="mt-3 leading-7">{labels.v2StartupHelp}</p>
            <button type="button" disabled={v2RetrySeconds > 0} onClick={retryV2Startup} className="mt-5 min-h-12 rounded-full bg-slate-950 px-6 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:opacity-45 dark:bg-[#e7b779] dark:text-slate-950 dark:focus-visible:outline-white">{labels.retry}</button>
          </section> : uncertainPublicBooking ? <section role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-50">
            <h2 ref={recoveryRef} tabIndex={-1} className="text-xl font-semibold">{legacyCutoverManual ? labels.legacyCutoverWarning : v2Warning || labels.uncertain}</h2>
            {!v2ManualOnly ? <p className="mt-3 leading-7">{legacyCutoverManual ? labels.legacyCutoverHelp : v2 ? labels.v2CheckHelp : labels.uncertainHelp}</p> : null}
            {v2 && !v2ManualOnly && v2Warning === labels.v2PreparedPending && !v2PreparedOffer
              ? <p className="mt-3 leading-7">{labels.v2PreparedNoSummary}</p> : null}
            {!v2ManualOnly && !legacyCutoverManual ? <button type="button" disabled={submitting || v2RetrySeconds > 0} onClick={retryOriginalBooking} className="mt-5 min-h-12 rounded-full bg-slate-950 px-6 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:opacity-45 dark:bg-[#e7b779] dark:text-slate-950 dark:focus-visible:outline-white">
              {submitting ? labels.saving : v2 ? labels.v2CheckOriginal : labels.checkOriginal}
            </button> : null}
            {v2 && !v2ManualOnly && v2PreparedOffer ? <div className="mt-5 rounded-xl border border-amber-400 bg-white/80 p-4 dark:bg-black/20">
              <h3 ref={preparedOfferRef} tabIndex={-1} className="font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 dark:focus-visible:outline-white">{labels.v2FinishSummary}</h3>
              <dl className="mt-3 space-y-2 text-sm">
                <div><dt className="font-semibold">{labels.salon}</dt><dd>{v2PreparedOffer.salonName}</dd></div>
                <div><dt className="font-semibold">{labels.service}</dt><dd>{v2PreparedOffer.serviceTitle}</dd></div>
                <div><dt className="font-semibold">{labels.staff}</dt><dd>{v2PreparedOffer.staffName}</dd></div>
                <div><dt className="font-semibold">{labels.date}</dt><dd>{new Intl.DateTimeFormat(locale, { timeZone: v2PreparedOffer.timeZone, dateStyle: "full", timeStyle: "short" }).format(new Date(v2PreparedOffer.startTime))} ({v2PreparedOffer.timeZone})</dd></div>
                <div><dt className="font-semibold">{labels.v2DisplayedPrice}</dt><dd>{money(v2PreparedOffer.displayedPrice, v2PreparedOffer.currency, locale)} ({v2PreparedOffer.currency})</dd></div>
              </dl>
              <p className="mt-3 text-sm">{labels.v2DisplayedPriceNote}</p>
              <p className="mt-4 leading-6">{labels.v2FinishHelp}</p>
              <button type="button" disabled={submitting || Boolean(v2ActionCooldown.commit) || v2RetrySeconds > 0} onClick={finishPreparedV2} className="mt-4 min-h-12 rounded-full bg-slate-950 px-6 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:opacity-45 dark:bg-[#e7b779] dark:text-slate-950 dark:focus-visible:outline-white">{labels.v2Finish}</button>
            </div> : null}
            {v2 && !v2ManualOnly && v2Intent.current ? <div className="mt-4">
              <p className="text-sm">{labels.v2CancelHelp}</p>
              <button type="button" disabled={submitting || Boolean(v2ActionCooldown.cancel)} onClick={cancelV2} className="mt-3 min-h-12 rounded-full border border-current px-5 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:opacity-45 dark:focus-visible:outline-white">{labels.v2Cancel}</button>
            </div> : null}
          </section> : <>
          <label className="block font-semibold">{labels.service}
            <select name="bookingService" disabled={!hydrated || submitting} value={serviceId} onChange={(event) => {
                if (typeof window !== "undefined") {
                  const url = new URL(window.location.href);
                  url.searchParams.set("service", event.target.value);
                  window.history.replaceState(window.history.state, "", url.href);
                }
                setLoadingSlots(true);
                setAvailabilityFailed(false);
                setSlots([]);
                setSlot(null);
                setPreferredStaffId("");
                setError("");
                setServiceId(event.target.value);
              }} className="mt-2 h-12 w-full rounded-xl border border-[#dfd2c1] bg-white px-4 dark:border-white/15 dark:bg-white/5">
              {services.map((item) => <option key={item.id} value={item.id}>{localizedServiceTitle(item.title_json, locale, countryDefaultLocale)}</option>)}
            </select>
          </label>
          {staffChoices.length ? <label className="block font-semibold">{labels.staff}
            <select name="bookingStaff" disabled={!hydrated || submitting} value={preferredStaffId} onChange={(event) => { setPreferredStaffId(event.target.value); setSlot(null); setError(""); }} className="mt-2 h-12 w-full rounded-xl border border-[#dfd2c1] bg-white px-4 dark:border-white/15 dark:bg-white/5">
              <option value="">{labels.anyStaff}</option>
              {staffChoices.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </label> : <div><p className="font-semibold">{labels.staff}</p><p className="mt-2 text-sm text-slate-600 dark:text-stone-300">{labels.anyStaff}</p></div>}
          <label className="block font-semibold">{labels.date}
            <input type="date" disabled={!hydrated || submitting} min={today} value={date} onChange={(event) => {
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
            {loadingSlots ? <p role="status" className="mt-3 text-sm text-slate-500">{labels.loading}</p> : availabilityFailed ? <div role="alert" className="mt-3"><p>{labels.availabilityError}</p><button type="button" onClick={reloadAvailability} className="mt-2 min-h-11 rounded-xl border border-[#d9c7b2] px-4 font-semibold">{labels.retry}</button></div> : visibleSlots.length ? <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {visibleSlots.map((value) => <label key={value.slot_start} className="cursor-pointer">
                <input type="radio" name="bookingTime" value={value.slot_start} checked={slot?.slot_start === value.slot_start} onChange={() => setSlot(value)} required className="peer sr-only" />
                <span className="flex min-h-11 items-center justify-center rounded-xl bg-[#f4ece2] text-sm font-semibold peer-checked:bg-[#e7b779] peer-checked:text-slate-950 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-slate-950 dark:bg-white/5 dark:peer-focus-visible:outline-white">
                  {new Intl.DateTimeFormat(locale, { timeZone: salon.timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(value.slot_start))}
                </span>
              </label>)}
            </div> : <div role="status" className="mt-3 rounded-xl bg-[#f4ece2] p-4 text-sm dark:bg-white/5"><p>{preferredStaffId ? labels.preferredStaffUnavailable : labels.noSlots}</p>{preferredStaffId ? <button type="button" onClick={() => { setPreferredStaffId(""); setSlot(null); }} className="mt-3 min-h-11 rounded-xl border border-[#d9c7b2] px-4 font-semibold">{labels.showAllStaff}</button> : null}</div>}
          </fieldset>
          <fieldset disabled={submitting} aria-describedby="booking-contact-hint" className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 font-semibold">{labels.details}</legend>
            <p id="booking-contact-hint" className="text-sm text-slate-600 dark:text-stone-300 sm:col-span-2">{labels.contact}</p>
            <label className="sm:col-span-2">{labels.name}<input name="fullName" autoComplete="name" minLength={2} maxLength={120} required className="mt-2 h-12 w-full rounded-xl border border-[#dfd2c1] bg-white px-4 dark:border-white/15 dark:bg-white/5" /></label>
            <label>{labels.phone}<input ref={contactRef} name="phone" type="tel" autoComplete="tel" aria-invalid={contactError} aria-describedby={`booking-contact-hint${contactError ? " booking-contact-error" : ""}`} onChange={() => { if (contactError) setError(""); }} maxLength={40} className="mt-2 h-12 w-full rounded-xl border border-[#dfd2c1] bg-white px-4 dark:border-white/15 dark:bg-white/5" /></label>
            <label>{labels.email}<input name="email" type="email" autoComplete="email" aria-invalid={contactError} aria-describedby={`booking-contact-hint${contactError ? " booking-contact-error" : ""}`} onChange={() => { if (contactError) setError(""); }} maxLength={160} className="mt-2 h-12 w-full rounded-xl border border-[#dfd2c1] bg-white px-4 dark:border-white/15 dark:bg-white/5" /></label>
          </fieldset>
          {error ? <p id={contactError ? "booking-contact-error" : undefined} role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</p> : null}
          <button type="submit" disabled={!slot || loadingSlots || submitting} className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-slate-950 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 dark:bg-[#e7b779] dark:text-slate-950">
            <Clock3 className="size-5" />{submitting ? labels.saving : sandbox ? paymentLabels.pay : labels.reserve}
          </button>
          </>}
        </form>
      </div>
    </div>
  </main>;
}

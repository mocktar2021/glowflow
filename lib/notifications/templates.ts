export type NotificationKind = "confirmation" | "reminder24h" | "reminder2h";
type NotificationLocale = "fr" | "en" | "es";

type NotificationInput = {
  kind: NotificationKind;
  clientLocale?: string | null;
  salonLocale?: string | null;
  salonName: string;
  serviceName: string;
  startsAt: string;
  timeZone: string;
  address: string;
};

const invalid = () => new Error("Invalid notification data");

function localeBase(value: unknown): NotificationLocale | undefined {
  if (typeof value !== "string" || value.length > 100) return undefined;
  try {
    const base = new Intl.Locale(value.trim()).language;
    return base === "fr" || base === "en" || base === "es" ? base : undefined;
  } catch {
    return undefined;
  }
}

function plainText(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>{}]/u.test(value)) throw invalid();
  const text = value.trim();
  if (!text || /%(?:[A-Za-z_][\w]*%|[sdif])/.test(text)) throw invalid();
  return text;
}

function instant(value: unknown): Date {
  if (typeof value !== "string") throw invalid();
  // Require an explicit offset: salon-local times are ambiguous at DST changes.
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) throw invalid();
  const [, year, month, day, hour, minute, second, , offset] = parts;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59) throw invalid();
  if (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) throw invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw invalid();
  return date;
}

/** Pure preview/rendering boundary. Calling it never schedules or sends a message. */
export function renderNotification(input: NotificationInput): { locale: NotificationLocale; text: string } {
  if (!input || !["confirmation", "reminder24h", "reminder2h"].includes(input.kind)) throw invalid();
  const salon = plainText(input.salonName, 160);
  const service = plainText(input.serviceName, 160);
  const address = plainText(input.address, 300);
  const date = instant(input.startsAt);
  const timeZone = plainText(input.timeZone, 100);
  const locale = localeBase(input.clientLocale) ?? localeBase(input.salonLocale) ?? "fr";
  let when: string;
  try {
    // ICU versions disagree on the connector between dateStyle and timeStyle
    // (for example Spanish ", " versus " a las "). Join the two explicitly so
    // server rendering and browser hydration produce identical message text.
    const day = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "long" }).format(date);
    const time = new Intl.DateTimeFormat(locale, { timeZone, timeStyle: "short" }).format(date);
    when = `${day} · ${time}`;
  } catch {
    throw invalid();
  }
  const headings = {
    fr: { confirmation: "Rendez-vous confirmé", reminder24h: "Rappel de rendez-vous — 24 heures", reminder2h: "Rappel de rendez-vous — 2 heures" },
    en: { confirmation: "Appointment confirmed", reminder24h: "Appointment reminder — 24 hours", reminder2h: "Appointment reminder — 2 hours" },
    es: { confirmation: "Cita confirmada", reminder24h: "Recordatorio de cita — 24 horas", reminder2h: "Recordatorio de cita — 2 horas" },
  };
  const labels = {
    fr: { salon: "Salon", service: "Prestation", when: "Date et heure", address: "Adresse", zone: "Fuseau horaire" },
    en: { salon: "Salon", service: "Service", when: "Date and time", address: "Address", zone: "Time zone" },
    es: { salon: "Salón", service: "Servicio", when: "Fecha y hora", address: "Dirección", zone: "Zona horaria" },
  }[locale];
  return {
    locale,
    text: `${headings[locale][input.kind]}\n${labels.salon} : ${salon}\n${labels.service} : ${service}\n${labels.when} : ${when}\n${labels.zone} : ${timeZone}\n${labels.address} : ${address}`,
  };
}

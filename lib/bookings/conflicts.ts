import type { Locale } from "@/lib/i18n";

type DatabaseError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

const conflictMessages: Record<Locale, string> = {
  fr: "Ce créneau n’est plus disponible. Choisissez une autre heure.",
  en: "This time is no longer available. Choose another time.",
  es: "Este horario ya no está disponible. Elige otra hora.",
};

export function isAppointmentConflict(error: DatabaseError | null | undefined) {
  if (!error) return false;
  const detail = `${error.message ?? ""} ${error.details ?? ""}`;
  return (
    error.code === "23P01" ||
    detail.includes("appointments_staff_no_overlap") ||
    detail.includes("appointments_station_no_overlap")
  );
}

export function appointmentConflictMessage(locale: Locale) {
  return conflictMessages[locale];
}

"use client";

import Link from "next/link";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { renderNotification, type NotificationKind } from "@/lib/notifications/templates";
import type { NotificationStatus } from "@/lib/notifications/status";

export type NotificationStatusRecord = {
  id: string;
  kind: NotificationKind;
  channel: "email" | "sms";
  scheduledFor: string;
  status: NotificationStatus;
  attemptCount: number;
};

const copy = {
  fr: { title: "Notifications", back: "Tableau de bord", intro: "Consultez l’état enregistré et prévisualisez les confirmations et rappels avec des données fictives. L’envoi par fournisseur est désactivé : aucun message client n’est envoyé.", delivery: "État de livraison", disabled: "Envoi désactivé", empty: "Aucune notification n’est planifiée.", unavailable: "L’état de livraison est momentanément indisponible.", attempts: "tentatives", kind: "Type de message", confirmation: "Confirmation de réservation", reminder24h: "Rappel 24 heures avant", reminder2h: "Rappel 2 heures avant", client: "Langue du client (exemple)", salon: "Langue du salon (exemple)", fallback: "Sans préférence", languageHelp: "La langue du client est prioritaire, puis celle du salon. Le français est utilisé si aucune des deux n’est disponible.", preview: "Message d’exemple", sample: "Données fictives · Salon Exemple · Europe/Paris", error: "Impossible de générer cet aperçu.", salonName: "Salon Exemple", serviceName: "Coupe (exemple)", address: "10 rue de Démonstration, Ville Exemple" },
  en: { title: "Notifications", back: "Dashboard", intro: "Review recorded status and preview confirmations and reminders with fictitious data. Provider delivery is disabled, so no customer messages are sent.", delivery: "Delivery status", disabled: "Sending disabled", empty: "No notifications are scheduled.", unavailable: "Delivery status is temporarily unavailable.", attempts: "attempts", kind: "Message type", confirmation: "Booking confirmation", reminder24h: "Reminder 24 hours before", reminder2h: "Reminder 2 hours before", client: "Client language (example)", salon: "Salon language (example)", fallback: "No preference", languageHelp: "The client language comes first, followed by the salon language. French is used when neither is available.", preview: "Sample message", sample: "Fictitious data · Example Salon · Europe/Paris", error: "This preview could not be generated.", salonName: "Example Salon", serviceName: "Haircut (example)", address: "10 Demonstration Street, Example City" },
  es: { title: "Notificaciones", back: "Panel", intro: "Consulta el estado registrado y previsualiza confirmaciones y recordatorios con datos ficticios. El envío del proveedor está desactivado, por lo que no se envían mensajes a clientes.", delivery: "Estado de entrega", disabled: "Envío desactivado", empty: "No hay notificaciones programadas.", unavailable: "El estado de entrega no está disponible temporalmente.", attempts: "intentos", kind: "Tipo de mensaje", confirmation: "Confirmación de reserva", reminder24h: "Recordatorio 24 horas antes", reminder2h: "Recordatorio 2 horas antes", client: "Idioma del cliente (ejemplo)", salon: "Idioma del salón (ejemplo)", fallback: "Sin preferencia", languageHelp: "Se utiliza primero el idioma del cliente y después el del salón. Si ninguno está disponible, se utiliza el francés.", preview: "Mensaje de ejemplo", sample: "Datos ficticios · Salón Ejemplo · Europe/Paris", error: "No se pudo generar esta vista previa.", salonName: "Salón Ejemplo", serviceName: "Corte (ejemplo)", address: "10 calle de Demostración, Ciudad Ejemplo" },
};
const statusCopy = {
  fr: { scheduled: "Planifiée", awaiting_consent: "Consentement non enregistré", opted_out: "Désinscription enregistrée", appointment_inactive: "Rendez-vous inactif", superseded: "Remplacée après reprogrammation", ready: "Prête, envoi désactivé", processing: "Traitement enregistré", retry_scheduled: "Nouvelle tentative planifiée", ready_to_retry: "Nouvelle tentative possible, envoi désactivé", delivered: "Livrée", failed: "Échec définitif", canceled: "Annulée" },
  en: { scheduled: "Scheduled", awaiting_consent: "No recorded consent", opted_out: "Opt-out recorded", appointment_inactive: "Appointment inactive", superseded: "Superseded after rescheduling", ready: "Ready, sending disabled", processing: "Processing recorded", retry_scheduled: "Retry scheduled", ready_to_retry: "Retry eligible, sending disabled", delivered: "Delivered", failed: "Permanently failed", canceled: "Canceled" },
  es: { scheduled: "Programada", awaiting_consent: "Sin consentimiento registrado", opted_out: "Baja registrada", appointment_inactive: "Cita inactiva", superseded: "Sustituida tras reprogramar", ready: "Lista, envío desactivado", processing: "Procesamiento registrado", retry_scheduled: "Reintento programado", ready_to_retry: "Reintento posible, envío desactivado", delivered: "Entregada", failed: "Fallo definitivo", canceled: "Cancelada" },
} as const;
const languages = { fr: "Français", en: "English", es: "Español" };
const controlClass = "mt-2 min-h-12 w-full rounded-xl border border-[#b6a38b] bg-white px-3 text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5728] dark:bg-[#202228] dark:text-stone-100";

export function NotificationTemplatePreview({ locale, records = [], statusUnavailable = false }: { locale: Locale; records?: NotificationStatusRecord[]; statusUnavailable?: boolean }) {
  const t = copy[locale];
  const [kind, setKind] = useState<NotificationKind>("confirmation");
  const [clientLocale, setClientLocale] = useState<string>(locale);
  const [salonLocale, setSalonLocale] = useState<string>("fr");
  let message: ReturnType<typeof renderNotification> | null = null;
  try {
    message = renderNotification({ kind, clientLocale, salonLocale, salonName: t.salonName, serviceName: t.serviceName, address: t.address, startsAt: "2030-06-15T12:00:00Z", timeZone: "Europe/Paris" });
  } catch { /* Keep validation errors out of the customer-facing preview. */ }
  return <main className="min-h-screen bg-[#FAF9F6] px-5 py-8 text-slate-950 dark:bg-[#17191e] dark:text-stone-100">
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${locale}/dashboard`} className="inline-flex min-h-11 items-center underline underline-offset-4">← {t.back}</Link>
      <h1 className="text-3xl font-semibold">{t.title}</h1>
      <p>{t.intro}</p>
      <section className="space-y-4 rounded-3xl border border-[#d9c7b2] bg-white p-5 sm:p-7 dark:bg-[#202228]" aria-labelledby="notification-delivery-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="notification-delivery-heading" className="text-lg font-semibold">{t.delivery}</h2>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-950 dark:bg-amber-300/15 dark:text-amber-100">{t.disabled}</span>
        </div>
        {statusUnavailable ? <p role="status">{t.unavailable}</p> : records.length === 0 ? <p>{t.empty}</p> : <ul className="divide-y divide-[#e8dfd2] dark:divide-white/10">
          {records.map((record) => <li key={record.id} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div><p className="font-medium">{t[record.kind]} · {record.channel.toUpperCase()}</p><p className="text-sm text-slate-600 dark:text-stone-300">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.scheduledFor))}</p></div>
            <p className="text-sm font-medium">{statusCopy[locale][record.status]} · {record.attemptCount} {t.attempts}</p>
          </li>)}
        </ul>}
      </section>
      <section className="space-y-5 rounded-3xl border border-[#d9c7b2] bg-white p-5 sm:p-7 dark:bg-[#202228]" aria-label={t.title}>
        <label className="block font-medium" htmlFor="notification-kind">{t.kind}
          <select id="notification-kind" className={controlClass} value={kind} onChange={(event) => setKind(event.target.value as NotificationKind)}>
            <option value="confirmation">{t.confirmation}</option><option value="reminder24h">{t.reminder24h}</option><option value="reminder2h">{t.reminder2h}</option>
          </select>
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          {([{ id: "client", label: t.client, value: clientLocale, update: setClientLocale }, { id: "salon", label: t.salon, value: salonLocale, update: setSalonLocale }]).map((field) => <label key={field.id} className="block font-medium" htmlFor={`notification-${field.id}`}>{field.label}
            <select id={`notification-${field.id}`} className={controlClass} value={field.value} onChange={(event) => field.update(event.target.value)} aria-describedby="notification-language-help">
              <option value="">{t.fallback}</option>
              {Object.entries(languages).map(([value, label]) => <option key={value} value={value} lang={value}>{label}</option>)}
            </select>
          </label>)}
        </div>
        <p id="notification-language-help" className="text-sm text-slate-600 dark:text-stone-300">{t.languageHelp}</p>
      </section>
      <section className="space-y-3 rounded-3xl border border-[#d9c7b2] bg-[#f4ede3] p-5 sm:p-7 dark:bg-[#28262a]" aria-labelledby="notification-preview-heading">
        <h2 id="notification-preview-heading" className="text-lg font-semibold">{t.preview}</h2>
        <p className="text-sm text-slate-600 dark:text-stone-300">{t.sample}</p>
        <div role="status" aria-live="polite" aria-atomic="true">
          {message ? <p lang={message.locale} className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</p> : <p>{t.error}</p>}
        </div>
      </section>
    </div>
  </main>;
}

import { notFound, redirect } from "next/navigation";
import { NotificationTemplatePreview, type NotificationStatusRecord } from "@/components/glowflow/notification-template-preview";
import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { deriveNotificationStatus, type NotificationAttempt } from "@/lib/notifications/status";
import type { NotificationKind } from "@/lib/notifications/templates";

export const dynamic = "force-dynamic";

type NotificationStatusRow = {
  id: string;
  appointment_start_time: string;
  schedule_generation: number | string;
  notification_kind: string;
  channel: string;
  scheduled_for: string;
  appointment_status: string | null;
  current_appointment_start_time: string | null;
  current_schedule_generation: number | string | null;
  consent_status: string | null;
  latest_event_type: NotificationAttempt["event_type"] | null;
  latest_retry_after: string | null;
  latest_lease_expires_at: string | null;
  latest_occurred_at: string | null;
  attempt_count: number | string;
};

export default async function NotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { supabase, userId } = await requireUser(locale);
  const { data: tenant, error } = await supabase.from("tenants")
    .select("id").eq("owner_id", userId).single();
  if (error || !tenant) redirect(`/${locale}/dashboard`);
  if (typeof supabase.rpc !== "function") return <NotificationTemplatePreview locale={locale} statusUnavailable />;

  const { data, error: statusError } = await supabase.rpc("get_notification_status_rows", {
    target_tenant_id: tenant.id,
    row_limit: 100,
  });
  const statusRows = data as NotificationStatusRow[] | null;
  if (statusError || !statusRows) return <NotificationTemplatePreview locale={locale} statusUnavailable />;
  const records: NotificationStatusRecord[] = statusRows.map((row) => ({
    id: row.id,
    kind: row.notification_kind as NotificationKind,
    channel: row.channel as "email" | "sms",
    scheduledFor: row.scheduled_for,
    status: deriveNotificationStatus({
      scheduledFor: row.scheduled_for,
      appointmentStartTime: row.appointment_start_time,
      currentAppointmentStartTime: row.current_appointment_start_time,
      scheduleGeneration: Number(row.schedule_generation),
      currentScheduleGeneration: row.current_schedule_generation === null ? null : Number(row.current_schedule_generation),
      appointmentStatus: row.appointment_status,
      consentStatus: row.consent_status as "consented" | "opted_out" | null,
      latestAttempt: row.latest_event_type ? {
        event_type: row.latest_event_type,
        retry_after: row.latest_retry_after,
        lease_expires_at: row.latest_lease_expires_at,
        occurred_at: row.latest_occurred_at ?? row.scheduled_for,
      } as NotificationAttempt : null,
    }),
    attemptCount: Number(row.attempt_count),
  }));

  return <NotificationTemplatePreview locale={locale} records={records} />;
}

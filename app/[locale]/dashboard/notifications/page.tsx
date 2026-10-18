import { notFound, redirect } from "next/navigation";
import { NotificationTemplatePreview, type NotificationAttemptRecord, type NotificationConsentRecord, type NotificationStatusRecord } from "@/components/glowflow/notification-template-preview";
import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { deriveNotificationStatus, type NotificationAttempt } from "@/lib/notifications/status";
import type { NotificationKind } from "@/lib/notifications/templates";

export const dynamic = "force-dynamic";

type NotificationStatusRow = {
  id: string;
  appointment_id: string;
  client_id: string;
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

type ConsentRow = {
  id: string;
  client_id: string;
  channel: "email" | "sms";
  consent_status: "consented" | "opted_out";
  occurred_at: string;
};

type AttemptRow = {
  id: string;
  outbox_id: string;
  event_type: NotificationAttempt["event_type"];
  attempt_number: number;
  occurred_at: string;
  error_code: string | null;
};

export default async function NotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { supabase, userId } = await requireUser(locale);
  const { data: member, error } = await supabase.from("users")
    .select("tenant_id,role").eq("id", userId).single();
  if (error || !member?.tenant_id || !["owner", "staff"].includes(member.role)) redirect(`/${locale}/dashboard`);
  if (typeof supabase.rpc !== "function") return <NotificationTemplatePreview locale={locale} statusUnavailable />;

  const [statusResult, consentResult, attemptResult] = await Promise.all([
    supabase.rpc("get_notification_status_rows", { target_tenant_id: member.tenant_id, row_limit: 100 }),
    supabase.from("client_notification_consent_events")
      .select("id,client_id,channel,consent_status,occurred_at")
      .eq("tenant_id", member.tenant_id).order("occurred_at", { ascending: false }).limit(100),
    supabase.from("notification_delivery_attempts")
      .select("id,outbox_id,event_type,attempt_number,occurred_at,error_code")
      .eq("tenant_id", member.tenant_id).order("occurred_at", { ascending: false }).limit(100),
  ]);
  const statusRows = statusResult.data as NotificationStatusRow[] | null;
  const consentRows = consentResult.data as ConsentRow[] | null;
  const attemptRows = attemptResult.data as AttemptRow[] | null;
  const historyUnavailable = Boolean(consentResult.error || attemptResult.error || !consentRows || !attemptRows);
  const clientIds = [...new Set([
    ...(statusRows ?? []).map((row) => row.client_id),
    ...(consentRows ?? []).map((row) => row.client_id),
  ])];
  const { data: clients } = clientIds.length
    ? await supabase.from("clients").select("id,full_name").eq("tenant_id", member.tenant_id).in("id", clientIds)
    : { data: [] };
  const clientNames = new Map((clients ?? []).map((client) => [client.id, client.full_name]));
  const consents: NotificationConsentRecord[] = (consentRows ?? []).map((row) => ({
    id: row.id,
    clientName: clientNames.get(row.client_id) ?? row.client_id,
    channel: row.channel,
    status: row.consent_status,
    occurredAt: row.occurred_at,
  }));
  const attempts: NotificationAttemptRecord[] = (attemptRows ?? []).map((row) => ({
    id: row.id,
    outboxId: row.outbox_id,
    eventType: row.event_type,
    attemptNumber: row.attempt_number,
    occurredAt: row.occurred_at,
    errorCode: row.error_code,
  }));
  if (statusResult.error || !statusRows) return <NotificationTemplatePreview locale={locale} statusUnavailable consents={consents} attempts={attempts} historyUnavailable={historyUnavailable} />;
  const records: NotificationStatusRecord[] = statusRows.map((row) => ({
    id: row.id,
    appointmentId: row.appointment_id,
    clientName: clientNames.get(row.client_id) ?? row.client_id,
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

  return <NotificationTemplatePreview locale={locale} records={records} consents={consents} attempts={attempts} historyUnavailable={historyUnavailable} />;
}

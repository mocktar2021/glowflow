export type NotificationStatus =
  | "scheduled"
  | "awaiting_consent"
  | "opted_out"
  | "appointment_inactive"
  | "superseded"
  | "ready"
  | "processing"
  | "retry_scheduled"
  | "ready_to_retry"
  | "delivered"
  | "failed"
  | "canceled";

export type NotificationAttempt = {
  event_type: "claimed" | "delivered" | "retryable" | "failed" | "canceled";
  retry_after: string | null;
  lease_expires_at: string | null;
  occurred_at: string;
};

export type NotificationStatusInput = {
  scheduledFor: string;
  appointmentStartTime: string;
  currentAppointmentStartTime: string | null;
  appointmentStatus: string | null;
  consentStatus: "consented" | "opted_out" | null;
  latestAttempt: NotificationAttempt | null;
  now?: Date;
};

function time(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure read model. It never schedules, claims, or sends a notification. */
export function deriveNotificationStatus(input: NotificationStatusInput): NotificationStatus {
  const now = (input.now ?? new Date()).getTime();
  const attempt = input.latestAttempt;

  if (attempt?.event_type === "delivered") return "delivered";
  if (attempt?.event_type === "failed") return "failed";
  if (attempt?.event_type === "canceled") return "canceled";
  if (input.appointmentStatus !== "confirmed") return "appointment_inactive";
  if (time(input.appointmentStartTime) !== time(input.currentAppointmentStartTime)) return "superseded";
  if (input.consentStatus === "opted_out") return "opted_out";
  if (input.consentStatus !== "consented") return "awaiting_consent";

  if (attempt?.event_type === "claimed") {
    const leaseEnd = time(attempt.lease_expires_at);
    return leaseEnd !== null && leaseEnd > now ? "processing" : "ready_to_retry";
  }
  if (attempt?.event_type === "retryable") {
    const retryAt = time(attempt.retry_after);
    return retryAt !== null && retryAt > now ? "retry_scheduled" : "ready_to_retry";
  }

  const scheduledAt = time(input.scheduledFor);
  return scheduledAt !== null && scheduledAt > now ? "scheduled" : "ready";
}

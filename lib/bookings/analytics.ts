/** Server-side response counts only. Never accept request, tenant, or provider data. */
const outcomes = ["confirmed", "slot_unavailable", "failed"] as const;
export type BookingOutcome = typeof outcomes[number];

export function recordBookingOutcome(outcome: BookingOutcome): void {
  // A runtime allowlist also protects JavaScript callers. Invalid input is dropped,
  // never serialized or coerced into a metric label.
  if (!outcomes.includes(outcome)) return;
  try {
    console.info(JSON.stringify({
      event: "glowflow_booking_outcome_count",
      version: 1,
      outcome,
      count: 1,
    }));
  } catch {
    // Metrics must never change booking responses or committed appointments.
  }
}

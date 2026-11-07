type Slot = { slot_start: string; staff_id: string };

/** Advance a salon-local calendar date without crossing a browser time-zone boundary. */
export function nextCalendarDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(value.getTime()) ||
      value.toISOString().slice(0, 10) !== date) throw new Error("invalid_calendar_date");
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

/** Only an explicit visitor action calls this bounded, read-only availability search. */
export async function findNextAvailableBookingDate(
  selectedDate: string,
  preferredStaffId: string,
  loadSlots: (date: string, signal: AbortSignal) => Promise<Slot[]>,
  signal: AbortSignal,
): Promise<string | null> {
  let candidate = selectedDate;
  for (let day = 0; day < 14; day += 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    candidate = nextCalendarDate(candidate);
    const slots = await loadSlots(candidate, signal);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (slots.some((slot) => !preferredStaffId || slot.staff_id === preferredStaffId)) return candidate;
  }
  return null;
}

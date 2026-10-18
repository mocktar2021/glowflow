const dayMilliseconds = 24 * 60 * 60 * 1000;

export function isValidIanaTimeZone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function timeZoneOptions(selectedZone: string): string[] {
  const zones = new Set(["UTC", ...Intl.supportedValuesOf("timeZone")]);
  if (isValidIanaTimeZone(selectedZone)) zones.add(selectedZone);
  return ["UTC", ...[...zones].filter((zone) => zone !== "UTC").sort()];
}

function localDateKey(formatter: Intl.DateTimeFormat, instant: number): string {
  const parts = formatter.formatToParts(new Date(instant));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year").padStart(4, "0")}-${value("month")}-${value("day")}`;
}

// Find the first instant of the next local day, then use the prior PostgreSQL
// microsecond. The search RPC compares with <=, so this includes the full day.
// Searching by local date handles 23-hour and 25-hour DST days without guessing
// a fixed UTC offset or relying on the server's own time zone.
export function endOfLocalDayUtc(date: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "0001-01-01" || date > "9998-12-31" || !isValidIanaTimeZone(timeZone)) return null;
  const midnightUtc = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(midnightUtc) || new Date(midnightUtc).toISOString().slice(0, 10) !== date) return null;
  const nextDayUtc = midnightUtc + dayMilliseconds;
  const nextDate = new Date(nextDayUtc).toISOString().slice(0, 10);
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  let low = nextDayUtc - 2 * dayMilliseconds;
  let high = nextDayUtc + 2 * dayMilliseconds;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (localDateKey(formatter, middle) >= nextDate) high = middle;
    else low = middle + 1;
  }
  if (localDateKey(formatter, low - 1) !== date) return null;
  return new Date(low - 1).toISOString().replace(/\.999Z$/, ".999999Z");
}

/**
 * Read-only aggregation of already authorized, tenant-scoped ledger rows.
 * This is not a gross-sales, tip, or deposit report: those classifications are
 * not present in payment_entries. Callers must still enforce owner/reporting
 * permission before reading the ledger.
 */
export type LedgerMethod = "cash" | "external_card" | "stripe";
export type DailyLedgerEntry = {
  tenant_id: string;
  currency: string;
  entry_type: "payment" | "refund";
  payment_method: LedgerMethod;
  amount: number;
  occurred_at: string;
};

export type MethodAmounts = Record<LedgerMethod, number>;
export type DailyLedgerTotals = {
  date: string;
  paidMinor: number;
  refundedMinor: number;
  netMinor: number;
  paymentsByMethod: MethodAmounts;
  refundsByMethod: MethodAmounts;
};

export type DailyLedgerReport =
  | { status: "invalid"; reason: "invalid_scope" | "invalid_entry" | "cross_tenant" | "currency_mismatch" | "too_many_entries" | "amount_overflow" }
  | { status: "ready"; tenantId: string; currency: string; timeZone: string; days: DailyLedgerTotals[] };

// A future database query must page or aggregate server-side beyond this limit.
export const MAX_DAILY_LEDGER_ENTRIES = 2000;

function methodAmounts(): MethodAmounts {
  return { cash: 0, external_card: 0, stripe: 0 };
}

function addChecked(left: number, right: number): number | null {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : null;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // JavaScript accepts year 0000, but salon report filters use calendar years.
  if (value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function aggregateDailyLedger(input: {
  tenantId: string;
  currency: string;
  timeZone: string;
  entries: readonly DailyLedgerEntry[];
  fromDate?: string;
  throughDate?: string;
}): DailyLedgerReport {
  const { tenantId, currency, timeZone, entries, fromDate, throughDate } = input;
  if (typeof tenantId !== "string" || !tenantId.trim()
    || !/^[A-Z]{3}$/.test(currency) || !timeZone || timeZone.length > 64) {
    return { status: "invalid", reason: "invalid_scope" };
  }
  if ((fromDate !== undefined && !isIsoDate(fromDate))
    || (throughDate !== undefined && !isIsoDate(throughDate))
    || (fromDate && throughDate && fromDate > throughDate)) {
    return { status: "invalid", reason: "invalid_scope" };
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    });
  } catch {
    return { status: "invalid", reason: "invalid_scope" };
  }
  if (entries.length > MAX_DAILY_LEDGER_ENTRIES) {
    return { status: "invalid", reason: "too_many_entries" };
  }

  const days = new Map<string, DailyLedgerTotals>();
  for (const entry of entries) {
    if (entry.tenant_id !== tenantId) return { status: "invalid", reason: "cross_tenant" };
    if (entry.currency !== currency) return { status: "invalid", reason: "currency_mismatch" };
    if ((entry.entry_type !== "payment" && entry.entry_type !== "refund")
      || !["cash", "external_card", "stripe"].includes(entry.payment_method)
      || !Number.isSafeInteger(entry.amount) || entry.amount <= 0
      || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(entry.occurred_at)
      || !isIsoDate(entry.occurred_at.slice(0, 10))) {
      return { status: "invalid", reason: "invalid_entry" };
    }
    const occurredAt = new Date(entry.occurred_at);
    if (!Number.isFinite(occurredAt.getTime())) return { status: "invalid", reason: "invalid_entry" };
    const parts = formatter.formatToParts(occurredAt);
    const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === name)?.value;
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    // Filter by the salon's local calendar date, never by a fixed UTC offset.
    if ((fromDate && date < fromDate) || (throughDate && date > throughDate)) continue;
    let day = days.get(date);
    if (!day) {
      day = { date, paidMinor: 0, refundedMinor: 0, netMinor: 0,
        paymentsByMethod: methodAmounts(), refundsByMethod: methodAmounts() };
      days.set(date, day);
    }
    const payment = entry.entry_type === "payment";
    const bucket = payment ? day.paymentsByMethod : day.refundsByMethod;
    const methodTotal = addChecked(bucket[entry.payment_method], entry.amount);
    const total = addChecked(payment ? day.paidMinor : day.refundedMinor, entry.amount);
    const net = addChecked(day.netMinor, payment ? entry.amount : -entry.amount);
    if (methodTotal === null || total === null || net === null) {
      return { status: "invalid", reason: "amount_overflow" };
    }
    bucket[entry.payment_method] = methodTotal;
    if (payment) day.paidMinor = total;
    else day.refundedMinor = total;
    day.netMinor = net;
  }
  return {
    status: "ready", tenantId, currency, timeZone,
    days: Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

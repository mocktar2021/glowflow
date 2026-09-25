export type LedgerEntry = {
  appointment_id: string;
  entry_type: "payment" | "refund";
  payment_method: "stripe" | "cash" | "external_card";
  amount: number;
  occurred_at?: string;
};

export type AppointmentPaymentSummary = {
  paid: number;
  refunded: number;
  netPaid: number;
  outstanding: number;
};

export function parseMinorAmount(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.replace(",", ".").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function paymentSummary(
  appointmentId: string,
  appointmentTotal: number,
  entries: LedgerEntry[],
): AppointmentPaymentSummary {
  let paid = 0;
  let refunded = 0;
  for (const entry of entries) {
    if (entry.appointment_id !== appointmentId) continue;
    if (entry.entry_type === "payment") paid += entry.amount;
    else refunded += entry.amount;
  }
  const netPaid = paid - refunded;
  return { paid, refunded, netPaid, outstanding: Math.max(appointmentTotal - netPaid, 0) };
}

export function localizedServiceTitle(
  title: Record<string, unknown>,
  locale: "fr" | "en" | "es",
) {
  const preferred = title[locale];
  if (typeof preferred === "string" && preferred.trim()) return preferred;
  const french = title.fr;
  return typeof french === "string" && french.trim() ? french : "—";
}

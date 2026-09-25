export type LedgerSummary = {
  appointment_id: string;
  currency: string;
  paid_amount: number;
  refunded_amount: number;
  net_paid_amount: number;
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
  summaries: LedgerSummary[],
): AppointmentPaymentSummary {
  const summary = summaries.find((item) => item.appointment_id === appointmentId);
  const paid = summary?.paid_amount ?? 0;
  const refunded = summary?.refunded_amount ?? 0;
  const netPaid = summary?.net_paid_amount ?? 0;
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

export type SandboxReservation = {
  id: string;
  tenant_id: string;
  appointment_id: string;
  client_id: string;
  service_id: string;
  stripe_account_id: string;
  amount: number;
  currency: string;
  service_title: Record<string, string>;
  locale: "fr" | "en" | "es";
  status: "reserved" | "pending" | "paid" | "expired" | "failed" | "reconciliation_required";
  expires_at: string;
  checkout_session_id: string | null;
  checkout_url: string | null;
};

export function assertSandboxMerchant(account: {
  id: string;
  livemode: boolean;
  metadata?: Record<string, string> | null;
  configuration?: { merchant?: { capabilities?: { card_payments?: { status?: string } | null } | null } | null } | null;
}, reservation: Pick<SandboxReservation, "tenant_id" | "stripe_account_id">) {
  if (account.id !== reservation.stripe_account_id || account.livemode ||
      account.metadata?.tenant_id !== reservation.tenant_id ||
      account.metadata?.environment !== "sandbox" || account.metadata?.product !== "glowflow" ||
      account.configuration?.merchant?.capabilities?.card_payments?.status !== "active") {
    throw new Error("sandbox_unavailable");
  }
}

export function sandboxCheckoutParameters(reservation: SandboxReservation, origin: string, salonSlug: string, now = Date.now()) {
  const expiresAt = Math.floor(Date.parse(reservation.expires_at) / 1000);
  // Preserve the stored expiry on retry. Stripe requires at least 30 minutes;
  // reserve a minute for network transit and stop ambiguous older attempts.
  if (reservation.status !== "reserved" || !Number.isFinite(expiresAt) ||
      expiresAt < Math.ceil(now / 1000) + 31 * 60 ||
      expiresAt > Math.floor(now / 1000) + 24 * 60 * 60 ||
      !Number.isSafeInteger(reservation.amount) || reservation.amount <= 0 ||
      !/^[A-Z]{3}$/.test(reservation.currency)) throw new Error("reconciliation_required");
  const metadata = {
    reservation_id: reservation.id, tenant_id: reservation.tenant_id,
    appointment_id: reservation.appointment_id, client_id: reservation.client_id,
    service_id: reservation.service_id, environment: "sandbox", product: "glowflow",
  };
  const returnUrl = `${origin}/${reservation.locale}/book/${encodeURIComponent(salonSlug)}?sandboxReservation=${reservation.id}`;
  return {
    mode: "payment" as const,
    integration_identifier: "glowflow_sandbox_qxmdrpta",
    expires_at: expiresAt,
    client_reference_id: reservation.id,
    line_items: [{ quantity: 1, price_data: {
      currency: reservation.currency.toLowerCase(), unit_amount: reservation.amount,
      product_data: { name: reservation.service_title[reservation.locale] ?? reservation.service_title.fr ?? "GlowFlow" },
    } }],
    metadata,
    payment_intent_data: { metadata },
    success_url: returnUrl,
    cancel_url: returnUrl,
  };
}

export function safeSandboxReservation(reservation: Pick<SandboxReservation, "id" | "status" | "expires_at" | "checkout_url">, now = Date.now()) {
  const expired = Date.parse(reservation.expires_at) <= now;
  return {
    reservationId: reservation.id,
    status: expired && ["reserved", "pending"].includes(reservation.status) ? "expired" : reservation.status,
    expiresAt: reservation.expires_at,
    url: !expired && reservation.status === "pending" ? reservation.checkout_url : null,
  };
}

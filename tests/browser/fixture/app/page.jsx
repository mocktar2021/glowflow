"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { LiveBookingFlow } from "@/components/glowflow/live-booking-flow";
import { SandboxPaymentStatusPanel } from "@/components/glowflow/sandbox-payment-status";
export default function Fixture() {
  const locale = usePathname().split("/")[1] || "fr";
  const search = useSearchParams();
  const id = search.get("sandboxReservation");
  if (id) return <SandboxPaymentStatusPanel locale={locale} salonSlug="browser-fixture" reservationId={id} />;
  return <LiveBookingFlow locale={locale} sandbox={search.get("sandbox") === "1"}
    salon={{ name: "Browser Fixture", slug: "browser-fixture", city: "Paris", currency: "EUR", timeZone: "Europe/Paris" }}
    services={[{ id: "11111111-1111-4111-8111-111111111111", title_json: { fr: "Coupe test", en: "Test haircut", es: "Corte de prueba" }, duration_minutes: 30, price: 5000, deposit_amount: 1500, currency: "EUR" }]} />;
}

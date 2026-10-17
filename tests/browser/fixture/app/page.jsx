"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { LiveBookingFlow } from "@/components/glowflow/live-booking-flow";
import { SandboxPaymentStatusPanel } from "@/components/glowflow/sandbox-payment-status";
import { NotificationTemplatePreview } from "@/components/glowflow/notification-template-preview";
export default function Fixture() {
  const locale = usePathname().split("/")[1] || "fr";
  const search = useSearchParams();
  if (search.get("templates") === "1") return <NotificationTemplatePreview locale={locale} />;
  const id = search.get("sandboxReservation");
  if (id) return <SandboxPaymentStatusPanel locale={locale} salonSlug="browser-fixture" reservationId={id} />;
  return <LiveBookingFlow locale={locale} initialServiceId={search.get("service") || undefined} sandbox={search.get("sandbox") === "1"}
    salon={{ name: "Browser Fixture", slug: "browser-fixture", city: "Paris", currency: "EUR", timeZone: "Europe/Paris" }}
    bookingStaffByService={{ "11111111-1111-4111-8111-111111111111": [{ id: "33333333-3333-4333-8333-333333333333", name: "Ari" }, { id: "66666666-6666-4666-8666-666666666666", name: "Ben" }], "44444444-4444-4444-8444-444444444444": [{ id: "66666666-6666-4666-8666-666666666666", name: "Ben" }] }}
    services={[{ id: "11111111-1111-4111-8111-111111111111", title_json: { fr: "Coupe test", en: "Test haircut", es: "Corte de prueba" }, duration_minutes: 30, price: 5000, deposit_amount: 1500, currency: "EUR" }, { id: "44444444-4444-4444-8444-444444444444", title_json: { fr: "Coiffage test", en: "Test styling", es: "Peinado de prueba" }, duration_minutes: 45, price: 6000, deposit_amount: 2000, currency: "EUR" }]} />;
}

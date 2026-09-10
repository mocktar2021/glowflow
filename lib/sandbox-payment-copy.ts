import type { Locale } from "@/lib/i18n";

export const sandboxPaymentCopy = {
  fr: {
    title: "Test d’acompte du salon", notice: "Mode test : aucune réservation réelle ni aucun paiement réel. Utilisez uniquement des coordonnées fictives.",
    pay: "Tester le paiement de l’acompte", refresh: "Vérifier le paiement", another: "Nouveau test", manage: "Vérifier le compte de test",
    unavailable: "Le test est indisponible. Vérifiez votre connexion propriétaire et le compte de test du salon.",
    reserved: "Créneau de test réservé. Continuez vers le paiement.", pending: "Paiement en cours de vérification. Le retour de Stripe ne confirme pas le paiement.",
    paid: "Acompte de test confirmé par Stripe. La réservation reste une simulation.", expired: "Le créneau de test a expiré. Lancez un nouveau test.",
    failed: "Le paiement de test a échoué. Lancez un nouveau test.", reconciliation_required: "Un paiement de test nécessite une vérification par le salon. Aucun nouveau rendez-vous ni remboursement automatique.",
  },
  en: {
    title: "Salon deposit test", notice: "Test mode: no real booking or real payment. Use fictional contact details only.",
    pay: "Test deposit payment", refresh: "Check payment", another: "New test", manage: "Check test account",
    unavailable: "Testing is unavailable. Check your owner sign-in and the salon’s test account.",
    reserved: "Test time held. Continue to payment.", pending: "Payment verification is pending. Returning from Stripe does not confirm payment.",
    paid: "Test deposit confirmed by Stripe. The booking remains a simulation.", expired: "The test hold expired. Start a new test.",
    failed: "Test payment failed. Start a new test.", reconciliation_required: "A test payment needs the salon’s review. No new appointment or automatic refund has been issued.",
  },
  es: {
    title: "Prueba de depósito del salón", notice: "Modo de prueba: sin reserva ni pago reales. Usa solo datos de contacto ficticios.",
    pay: "Probar el pago del depósito", refresh: "Verificar pago", another: "Nueva prueba", manage: "Verificar cuenta de prueba",
    unavailable: "La prueba no está disponible. Verifica tu sesión de propietario y la cuenta de prueba del salón.",
    reserved: "Horario de prueba retenido. Continúa al pago.", pending: "El pago está pendiente de verificación. Volver de Stripe no confirma el pago.",
    paid: "Stripe confirmó el depósito de prueba. La reserva sigue siendo una simulación.", expired: "La retención de prueba caducó. Inicia una nueva prueba.",
    failed: "El pago de prueba falló. Inicia una nueva prueba.", reconciliation_required: "Un pago de prueba necesita revisión del salón. No se ha creado otra cita ni un reembolso automático.",
  },
} satisfies Record<Locale, Record<string, string>>;

export type SandboxPaymentStatus = "reserved" | "pending" | "paid" | "expired" | "failed" | "reconciliation_required";

export function isSandboxPaymentStatus(value: unknown): value is SandboxPaymentStatus {
  return typeof value === "string" && ["reserved", "pending", "paid", "expired", "failed", "reconciliation_required"].includes(value);
}

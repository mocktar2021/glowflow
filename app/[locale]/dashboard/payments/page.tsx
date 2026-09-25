import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { localizedServiceTitle, paymentSummary, type LedgerSummary } from "@/lib/payments/recording";
import { sandboxOwner } from "@/lib/stripe-sandbox";
import { sandboxConfiguration } from "@/lib/stripe-sandbox-config";
import { sandboxDepositConfiguration } from "@/lib/stripe-deposits-config";
import { sandboxPaymentCopy } from "@/lib/sandbox-payment-copy";
import { createStripeClient } from "@/lib/stripe";
import { recordManualPayment, startSandboxOnboarding } from "./actions";

export const dynamic = "force-dynamic";

const copy = {
  fr: { title: "Paiements", back: "Tableau de bord", ledger: "Encaissements", ledgerIntro: "Enregistrez un paiement reçu au salon. Le montant restant provient du tarif figé lors de la réservation.", ledgerUnavailable: "Les encaissements sont temporairement indisponibles. Aucun paiement ne peut être enregistré.", noAppointments: "Aucun rendez-vous à encaisser.", cash: "Espèces", externalCard: "Carte encaissée hors GlowFlow", amount: "Montant", method: "Mode de paiement", record: "Enregistrer", total: "Total", netPaid: "Net encaissé", outstanding: "Reste", recorded: "Paiement enregistré.", invalidPayment: "Saisissez un montant valide.", exceeds: "Le montant dépasse le solde restant.", recordFailed: "Le paiement n’a pas pu être enregistré.", sandbox: "Environnement de test", intro: "Configurez votre compte Stripe de test. Aucun paiement réel ne sera effectué.", start: "Configurer mon compte de test", resume: "Continuer la configuration", ready: "Votre compte de test est prêt à accepter des paiements par carte.", pending: "La configuration de votre compte de test reste à terminer.", disabled: "La configuration des paiements de test n’est pas encore disponible.", failed: "La connexion à Stripe a échoué. Réessayez ou contactez l’assistance.", reconcile: "Votre configuration nécessite une vérification par l’assistance avant de continuer.", market: "Les paiements Stripe ne sont pas disponibles pour ce pays.", returned: "Votre retour de Stripe ne confirme pas la validation du compte. Le statut ci-dessous provient de Stripe.", terms: "Votre salon reçoit ses paiements et paie les frais Stripe. GlowFlow ne prélève aucune commission sur les réservations.", refresh: "Le lien a expiré. Reprenez la configuration pour obtenir un nouveau lien.", dashboard: "Ouvrir Stripe", later: "Les acomptes en ligne seront disponibles après validation de l’intégration." },
  en: { title: "Payments", back: "Dashboard", ledger: "Record payments", ledgerIntro: "Record a payment received by the salon. The outstanding amount uses the price captured when the appointment was booked.", ledgerUnavailable: "Payment records are temporarily unavailable. No payment can be recorded.", noAppointments: "No appointments are ready for payment.", cash: "Cash", externalCard: "Card processed outside GlowFlow", amount: "Amount", method: "Payment method", record: "Record", total: "Total", netPaid: "Net recorded", outstanding: "Outstanding", recorded: "Payment recorded.", invalidPayment: "Enter a valid amount.", exceeds: "The amount exceeds the outstanding balance.", recordFailed: "The payment could not be recorded.", sandbox: "Test environment", intro: "Set up your test Stripe account. No real payments will be processed.", start: "Set up my test account", resume: "Continue setup", ready: "Your test account is ready to accept card payments.", pending: "Your test account setup still needs attention.", disabled: "Test payment setup is not available yet.", failed: "The Stripe connection failed. Try again or contact support.", reconcile: "Support must review your account setup before you continue.", market: "Stripe payments are unavailable for this country.", returned: "Returning from Stripe does not confirm account approval. The status below comes from Stripe.", terms: "Your salon receives its payments and pays Stripe processing fees. GlowFlow charges no booking commission.", refresh: "Your link expired. Continue setup to get a new link.", dashboard: "Open Stripe", later: "Online deposits will become available after integration verification." },
  es: { title: "Pagos", back: "Panel", ledger: "Registrar cobros", ledgerIntro: "Registre un pago recibido por el salón. El saldo usa el precio guardado al reservar la cita.", ledgerUnavailable: "Los registros de cobro no están disponibles temporalmente. No se puede registrar ningún pago.", noAppointments: "No hay citas listas para cobrar.", cash: "Efectivo", externalCard: "Tarjeta procesada fuera de GlowFlow", amount: "Importe", method: "Método de pago", record: "Registrar", total: "Total", netPaid: "Neto registrado", outstanding: "Pendiente", recorded: "Pago registrado.", invalidPayment: "Introduzca un importe válido.", exceeds: "El importe supera el saldo pendiente.", recordFailed: "No se pudo registrar el pago.", sandbox: "Entorno de prueba", intro: "Configure su cuenta de prueba de Stripe. No se procesarán pagos reales.", start: "Configurar mi cuenta de prueba", resume: "Continuar configuración", ready: "Su cuenta de prueba está lista para aceptar pagos con tarjeta.", pending: "La configuración de su cuenta de prueba requiere atención.", disabled: "La configuración de pagos de prueba aún no está disponible.", failed: "La conexión con Stripe ha fallado. Inténtelo de nuevo o contacte con soporte.", reconcile: "Soporte debe revisar su configuración antes de continuar.", market: "Los pagos Stripe no están disponibles para este país.", returned: "Volver de Stripe no confirma la aprobación de la cuenta. El estado siguiente proviene de Stripe.", terms: "Su salón recibe sus pagos y paga las comisiones de Stripe. GlowFlow no cobra comisión por reserva.", refresh: "Su enlace ha caducado. Continúe la configuración para obtener un nuevo enlace.", dashboard: "Abrir Stripe", later: "Los depósitos en línea estarán disponibles después de verificar la integración." },
};

type Appointment = { id: string; start_time: string; service_title_json: Record<string, unknown>; service_price: number; service_currency: string };

export default async function PaymentsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; returned?: string; refresh?: string; recorded?: string; record_error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const owner = await sandboxOwner();
  if (!owner) redirect(`/${locale}/dashboard`);
  const t = copy[locale];
  const query = await searchParams;
  const config = sandboxConfiguration(process.env);
  const depositConfig = sandboxDepositConfiguration(process.env);
  const { data: appointments, error: appointmentsError } = await owner.supabase.from("appointments")
    .select("id,start_time,service_title_json,service_price,service_currency")
    .neq("status", "canceled").order("start_time", { ascending: false }).limit(20);
  const appointmentIds = appointments?.map((appointment) => appointment.id) ?? [];
  const { data: summaries, error: summariesError } = appointmentIds.length
    ? await owner.supabase.rpc("get_appointment_payment_summaries", {
      target_appointment_ids: appointmentIds,
    })
    : { data: [], error: null };
  const ledgerUnavailable = !!appointmentsError || !!summariesError;
  const { data: ownedSalon } = depositConfig ? await owner.supabase.from("tenants").select("slug").eq("id", owner.tenant.id).single() : { data: null };
  const { data: connection, error } = await owner.supabase.from("stripe_sandbox_connections").select("stripe_account_id").eq("tenant_id", owner.tenant.id).maybeSingle();
  let ready = false;
  let unavailable = !config || !!error;
  if (config && connection?.stripe_account_id) {
    try {
      const stripe = createStripeClient();
      const platform = await stripe.accounts.retrieve(null);
      if (platform.id !== config.platformAccountId) throw new Error("wrong_platform");
      const account = await stripe.v2.core.accounts.retrieve(connection.stripe_account_id, { include: ["configuration.merchant"] });
      if (account.livemode || account.metadata?.tenant_id !== owner.tenant.id || account.metadata?.environment !== "sandbox") throw new Error("wrong_account");
      ready = account.configuration?.merchant?.capabilities?.card_payments?.status === "active";
    } catch { unavailable = true; }
  }
  return <main className="min-h-screen bg-[#FAF9F6] px-5 py-10 text-slate-950 dark:bg-[#17191e] dark:text-stone-100">
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/${locale}/dashboard`} className="text-[#a66e38]">← {t.back}</Link>
      <h1 className="text-3xl font-semibold">{t.title}</h1>
      <p className="text-lg">{owner.tenant.name}</p>
      <section className="space-y-5 rounded-3xl border border-[#d9c7b2] bg-white p-6 dark:bg-[#202228]">
        <div><h2 className="font-semibold text-[#a66e38]">{t.ledger}</h2><p className="mt-2 text-sm text-slate-600 dark:text-stone-300">{t.ledgerIntro}</p></div>
        {query.recorded && <p role="status" className="text-emerald-700 dark:text-emerald-300">{t.recorded}</p>}
        {query.record_error && <p role="alert" className="text-red-700 dark:text-red-300">{query.record_error === "invalid_payment" ? t.invalidPayment : query.record_error === "payment_exceeds_outstanding_balance" ? t.exceeds : t.recordFailed}</p>}
        {ledgerUnavailable && <p role="alert" className="text-red-700 dark:text-red-300">{t.ledgerUnavailable}</p>}
        {!ledgerUnavailable && !appointments?.length && <p>{t.noAppointments}</p>}
        {!ledgerUnavailable && <div className="space-y-4">
          {(appointments as Appointment[] | null)?.map((appointment) => {
            const summary = paymentSummary(appointment.id, appointment.service_price, (summaries ?? []) as LedgerSummary[]);
            const money = (amount: number) => new Intl.NumberFormat(locale, { style: "currency", currency: appointment.service_currency }).format(amount / 100);
            return <article key={appointment.id} className="space-y-3 rounded-2xl border border-stone-200 p-4 dark:border-stone-700">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h3 className="font-semibold">{localizedServiceTitle(appointment.service_title_json, locale)}</h3><p className="text-sm text-slate-600 dark:text-stone-300">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(appointment.start_time))}</p></div>
                <div className="text-right text-sm"><p>{t.total}: {money(appointment.service_price)}</p><p>{t.netPaid}: {money(summary.netPaid)}</p><p className="font-semibold">{t.outstanding}: {money(summary.outstanding)}</p></div>
              </div>
              {summary.outstanding > 0 && <form action={recordManualPayment.bind(null, locale)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <input type="hidden" name="appointment_id" value={appointment.id} />
                <input type="hidden" name="request_key" value={crypto.randomUUID()} />
                <label className="text-sm font-medium">{t.amount}<input required inputMode="decimal" name="amount" min="0.01" max={(summary.outstanding / 100).toFixed(2)} step="0.01" placeholder={(summary.outstanding / 100).toFixed(2)} className="mt-1 min-h-12 w-full rounded-xl border border-stone-300 bg-transparent px-3" /></label>
                <label className="text-sm font-medium">{t.method}<select name="payment_method" className="mt-1 min-h-12 w-full rounded-xl border border-stone-300 bg-transparent px-3"><option value="cash">{t.cash}</option><option value="external_card">{t.externalCard}</option></select></label>
                <button type="submit" className="min-h-12 rounded-full bg-slate-950 px-5 font-semibold text-white dark:bg-[#e8bb82] dark:text-slate-950">{t.record}</button>
              </form>}
            </article>;
          })}
        </div>}
      </section>
      <section className="space-y-5 rounded-3xl border border-[#d9c7b2] bg-white p-6 dark:bg-[#202228]">
        <h2 className="font-semibold text-[#a66e38]">{t.sandbox}</h2>
        <p>{t.intro}</p><p>{t.terms}</p>
        {query.returned && <p role="status">{t.returned}</p>}
        {query.refresh && <p role="status">{t.refresh}</p>}
        {query.error && <p role="alert" className="text-red-700 dark:text-red-300">{query.error === "reconciliation_required" ? t.reconcile : query.error === "market_unavailable" ? t.market : t.failed}</p>}
        <p role="status">{unavailable ? t.disabled : ready ? t.ready : t.pending}</p>
        {!unavailable && <form action={startSandboxOnboarding.bind(null, locale)}><button className="min-h-12 rounded-full bg-slate-950 px-6 py-3 font-semibold text-white dark:bg-[#e8bb82] dark:text-slate-950" type="submit">{connection?.stripe_account_id ? t.resume : t.start}</button></form>}
        {ready && <a href="https://dashboard.stripe.com/" target="_blank" rel="noopener noreferrer" className="inline-block text-[#a66e38]">{t.dashboard}</a>}
        {ready && depositConfig && ownedSalon && <Link href={`/${locale}/book/${ownedSalon.slug}?sandbox=1`} className="block rounded-full border border-[#d9c7b2] px-6 py-3 text-center font-semibold">{sandboxPaymentCopy[locale].pay}</Link>}
        <p className="text-sm text-slate-600 dark:text-stone-300">{t.later}</p>
      </section>
    </div>
  </main>;
}

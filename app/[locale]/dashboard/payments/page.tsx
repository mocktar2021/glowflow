import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { sandboxOwner } from "@/lib/stripe-sandbox";
import { sandboxConfiguration } from "@/lib/stripe-sandbox-config";
import { sandboxDepositConfiguration } from "@/lib/stripe-deposits-config";
import { sandboxPaymentCopy } from "@/lib/sandbox-payment-copy";
import { createStripeClient } from "@/lib/stripe";
import { startSandboxOnboarding } from "./actions";

export const dynamic = "force-dynamic";

const copy = {
  fr: { title: "Configurer les paiements", back: "Tableau de bord", sandbox: "Environnement de test", intro: "Configurez votre compte Stripe de test. Aucun paiement réel ne sera effectué.", start: "Configurer mon compte de test", resume: "Continuer la configuration", ready: "Votre compte de test est prêt à accepter des paiements par carte.", pending: "La configuration de votre compte de test reste à terminer.", disabled: "La configuration des paiements de test n’est pas encore disponible.", failed: "La connexion à Stripe a échoué. Réessayez ou contactez l’assistance.", reconcile: "Votre configuration nécessite une vérification par l’assistance avant de continuer.", market: "Les paiements Stripe ne sont pas disponibles pour ce pays.", returned: "Votre retour de Stripe ne confirme pas la validation du compte. Le statut ci-dessous provient de Stripe.", terms: "Votre salon reçoit ses paiements et paie les frais Stripe. GlowFlow ne prélève aucune commission sur les réservations.", refresh: "Le lien a expiré. Reprenez la configuration pour obtenir un nouveau lien.", dashboard: "Ouvrir Stripe", later: "Les acomptes en ligne seront disponibles après validation de l’intégration." },
  en: { title: "Set up payments", back: "Dashboard", sandbox: "Test environment", intro: "Set up your test Stripe account. No real payments will be processed.", start: "Set up my test account", resume: "Continue setup", ready: "Your test account is ready to accept card payments.", pending: "Your test account setup still needs attention.", disabled: "Test payment setup is not available yet.", failed: "The Stripe connection failed. Try again or contact support.", reconcile: "Support must review your account setup before you continue.", market: "Stripe payments are unavailable for this country.", returned: "Returning from Stripe does not confirm account approval. The status below comes from Stripe.", terms: "Your salon receives its payments and pays Stripe processing fees. GlowFlow charges no booking commission.", refresh: "Your link expired. Continue setup to get a new link.", dashboard: "Open Stripe", later: "Online deposits will become available after integration verification." },
  es: { title: "Configurar pagos", back: "Panel", sandbox: "Entorno de prueba", intro: "Configure su cuenta de prueba de Stripe. No se procesarán pagos reales.", start: "Configurar mi cuenta de prueba", resume: "Continuar configuración", ready: "Su cuenta de prueba está lista para aceptar pagos con tarjeta.", pending: "La configuración de su cuenta de prueba requiere atención.", disabled: "La configuración de pagos de prueba aún no está disponible.", failed: "La conexión con Stripe ha fallado. Inténtelo de nuevo o contacte con soporte.", reconcile: "Soporte debe revisar su configuración antes de continuar.", market: "Los pagos de Stripe no están disponibles para este país.", returned: "Volver de Stripe no confirma la aprobación de la cuenta. El estado siguiente proviene de Stripe.", terms: "Su salón recibe sus pagos y paga las comisiones de Stripe. GlowFlow no cobra comisión por reserva.", refresh: "Su enlace ha caducado. Continúe la configuración para obtener uno nuevo.", dashboard: "Abrir Stripe", later: "Los depósitos en línea estarán disponibles después de verificar la integración." },
};

export default async function PaymentsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; returned?: string; refresh?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const owner = await sandboxOwner();
  if (!owner) redirect(`/${locale}/dashboard`);
  const t = copy[locale];
  const query = await searchParams;
  const config = sandboxConfiguration(process.env);
  const depositConfig = sandboxDepositConfiguration(process.env);
  const { data: ownedSalon } = depositConfig ? await owner.supabase.from("tenants").select("slug").eq("id", owner.tenant.id).single() : { data: null };
  const { data: connection, error } = await owner.supabase.from("stripe_sandbox_connections")
    .select("stripe_account_id").eq("tenant_id", owner.tenant.id).maybeSingle();
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
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/${locale}/dashboard`} className="text-[#a66e38]">← {t.back}</Link>
      <h1 className="text-3xl font-semibold">{t.title}</h1>
      <p className="text-lg">{owner.tenant.name}</p>
      <section className="space-y-5 rounded-3xl border border-[#d9c7b2] bg-white p-6 dark:bg-[#202228]">
        <h2 className="font-semibold text-[#a66e38]">{t.sandbox}</h2>
        <p>{t.intro}</p><p>{t.terms}</p>
        {query.returned && <p role="status">{t.returned}</p>}
        {query.refresh && <p role="status">{t.refresh}</p>}
        {query.error && <p role="alert" className="text-red-700 dark:text-red-300">{query.error === "reconciliation_required" ? t.reconcile : query.error === "market_unavailable" ? t.market : t.failed}</p>}
        <p role="status">{unavailable ? t.disabled : ready ? t.ready : t.pending}</p>
        {!unavailable && <form action={startSandboxOnboarding.bind(null, locale)}>
          <button className="min-h-12 rounded-full bg-slate-950 px-6 py-3 font-semibold text-white dark:bg-[#e8bb82] dark:text-slate-950" type="submit">{connection?.stripe_account_id ? t.resume : t.start}</button>
        </form>}
        {ready && <a href="https://dashboard.stripe.com/" target="_blank" rel="noopener noreferrer" className="inline-block text-[#a66e38]">{t.dashboard}</a>}
        {ready && depositConfig && ownedSalon && <Link href={`/${locale}/book/${ownedSalon.slug}?sandbox=1`} className="block rounded-full border border-[#d9c7b2] px-6 py-3 text-center font-semibold">{sandboxPaymentCopy[locale].pay}</Link>}
        <p className="text-sm text-slate-600 dark:text-stone-300">{t.later}</p>
      </section>
    </div>
  </main>;
}

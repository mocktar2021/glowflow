import { randomUUID } from "node:crypto";

import { ArrowLeft, MailPlus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { staffInvitationManagementEnabled } from "@/lib/staff-invitations";

import { requestStaffInvitation } from "./actions";

export const dynamic = "force-dynamic";

const copy = {
  fr: {
    back: "Tableau de bord", title: "Inviter un membre de l'équipe",
    intro: "Envoyez une invitation sécurisée à une personne qui travaillera dans votre salon.",
    email: "Adresse e-mail du membre", submit: "Demander une invitation",
    requested: "Demande enregistrée. L'envoi sera traité séparément. Vérifiez l'adresse avant de réessayer.",
    unavailable: "Impossible d'enregistrer cette demande pour le moment. Réessayez plus tard.",
    note: "Le lien expire après 48 heures. Une personne ne peut rejoindre qu'un seul salon avec son compte.",
  },
  en: {
    back: "Dashboard", title: "Invite a team member",
    intro: "Send a secure invitation to someone who will work in your salon.",
    email: "Team member email", submit: "Request invitation",
    requested: "Request recorded. Delivery is handled separately. Check the address before trying again.",
    unavailable: "This request could not be recorded right now. Please try later.",
    note: "The link expires after 48 hours. One account can join only one salon.",
  },
  es: {
    back: "Panel", title: "Invitar a un miembro del equipo",
    intro: "Envía una invitación segura a alguien que trabajará en tu salón.",
    email: "Correo del miembro", submit: "Solicitar invitación",
    requested: "Solicitud registrada. El envío se procesa por separado. Comprueba la dirección antes de volver a intentarlo.",
    unavailable: "No se pudo registrar esta solicitud ahora. Inténtalo más tarde.",
    note: "El enlace caduca después de 48 horas. Cada cuenta solo puede unirse a un salón.",
  },
} as const;

export default async function StaffInvitationPage({
  params, searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ requested?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale) || !staffInvitationManagementEnabled()) notFound();
  const { supabase, userId } = await requireUser(locale);
  const { data: membership } = await supabase
    .from("users").select("tenant_id,role").eq("id", userId).single();
  if (!membership?.tenant_id || membership.role !== "owner") notFound();
  const { data: tenant } = await supabase
    .from("tenants").select("owner_id").eq("id", membership.tenant_id).single();
  if (tenant?.owner_id !== userId) notFound();

  const labels = copy[locale];
  const query = await searchParams;
  return (
    <main className="min-h-screen bg-[#faf9f6] px-4 py-8 text-slate-950 dark:bg-[#101216] dark:text-stone-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <Link href={`/${locale}/dashboard`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#9a602d] hover:underline dark:text-[#efc992]"><ArrowLeft className="size-4" />{labels.back}</Link>
        <header className="mt-5 flex items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#f1dfc8] text-[#9a602d] dark:bg-[#30261d] dark:text-[#efc992]"><MailPlus className="size-6" /></span>
          <div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{labels.title}</h1><p className="mt-2 text-slate-600 dark:text-stone-300">{labels.intro}</p></div>
        </header>
        {query.requested === "1" ? <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{labels.requested}</p> : null}
        {query.error ? <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{labels.unavailable}</p> : null}
        <section className="mt-8 rounded-3xl border border-[#e4d6c5] bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#17191e] sm:p-8">
          <form action={requestStaffInvitation.bind(null, locale)} className="grid gap-5">
            <input type="hidden" name="request_key" value={randomUUID()} />
            <label className="grid gap-2 text-sm font-semibold" htmlFor="staff-invite-email">{labels.email}</label>
            <input id="staff-invite-email" type="email" name="email" autoComplete="email" required maxLength={320} className="min-h-12 rounded-xl border border-[#cdbda8] bg-[#fffdf9] px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-[#9a602d] dark:border-white/20 dark:bg-[#111319]" />
            <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b77a42] focus-visible:ring-offset-2 dark:bg-[#e8bb82] dark:text-slate-950">{labels.submit}</button>
          </form>
          <p className="mt-5 text-sm text-slate-600 dark:text-stone-300">{labels.note}</p>
        </section>
      </div>
    </main>
  );
}

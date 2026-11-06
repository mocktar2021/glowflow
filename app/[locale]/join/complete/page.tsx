import { notFound } from "next/navigation";

import { AuthShell } from "@/components/glowflow/auth-shell";
import { isLocale } from "@/lib/i18n";
import { staffInvitationsEnabled } from "@/lib/staff-invitations";

export const dynamic = "force-dynamic";

const copy = {
  fr: { title: "Vérifiez votre e-mail", subtitle: "Après avoir vérifié votre adresse e-mail, ouvrez à nouveau le lien d'invitation d'origine pour rejoindre le salon." },
  en: { title: "Verify your email", subtitle: "After verifying your email address, reopen the original invitation link to join the salon." },
  es: { title: "Verifica tu correo", subtitle: "Después de verificar tu correo, vuelve a abrir el enlace de invitación original para unirte al salón." },
} as const;

export default async function JoinCompletePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale) || !staffInvitationsEnabled()) notFound();
  return <AuthShell locale={locale} title={copy[locale].title} subtitle={copy[locale].subtitle}><></></AuthShell>;
}

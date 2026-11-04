import { notFound } from "next/navigation";

import { AuthShell } from "@/components/glowflow/auth-shell";
import { isLocale } from "@/lib/i18n";
import { staffInvitationsEnabled } from "@/lib/staff-invitations";
import { createClient } from "@/lib/supabase/server";

import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";

const copy = {
  fr: { title: "Rejoindre un salon", subtitle: "Utilisez le lien reçu par e-mail pour rejoindre l'équipe du salon." },
  en: { title: "Join a salon", subtitle: "Use the link from your email to join the salon team." },
  es: { title: "Unirse a un salón", subtitle: "Usa el enlace de tu correo para unirte al equipo del salón." },
} as const;

export default async function JoinPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale) || !staffInvitationsEnabled()) notFound();

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const initialName = typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  return (
    <AuthShell locale={locale} title={copy[locale].title} subtitle={copy[locale].subtitle} showLanguageSwitcher={false}>
      <JoinForm locale={locale} signedIn={Boolean(user)} confirmed={Boolean(user?.email_confirmed_at)} initialName={initialName} />
    </AuthShell>
  );
}

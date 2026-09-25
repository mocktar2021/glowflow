import { notFound } from "next/navigation";

import { AuthMessage, AuthShell, buttonClass, inputClass } from "@/components/glowflow/auth-shell";
import { isLocale } from "@/lib/i18n";
import { requestPasswordReset } from "../auth-actions";
import { authCopy } from "@/lib/auth-copy";

export default async function ForgotPasswordPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ message?: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const notices = await searchParams;
  const labels = authCopy[locale].forgot;

  return (
    <AuthShell locale={locale} title={labels.title} subtitle={labels.subtitle}>
      <AuthMessage {...notices} />
      <form action={requestPasswordReset.bind(null, locale)} className="space-y-4">
        <label className="block text-sm font-medium">{labels.email}<input className={`${inputClass} mt-2`} name="email" type="email" autoComplete="email" required /></label>
        <button className={buttonClass} type="submit">{labels.submit}</button>
      </form>
    </AuthShell>
  );
}

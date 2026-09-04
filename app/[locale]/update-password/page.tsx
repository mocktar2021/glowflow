import { notFound } from "next/navigation";

import { AuthMessage, AuthShell, buttonClass, inputClass } from "@/components/glowflow/auth-shell";
import { isLocale } from "@/lib/i18n";
import { updatePassword } from "../auth-actions";

export default async function UpdatePasswordPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const notices = await searchParams;

  return (
    <AuthShell locale={locale} title="Choose a new password" subtitle="Use at least eight characters.">
      <AuthMessage {...notices} />
      <form action={updatePassword.bind(null, locale)} className="space-y-4">
        <label className="block text-sm font-medium">New password<input className={`${inputClass} mt-2`} name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <button className={buttonClass} type="submit">Update password</button>
      </form>
    </AuthShell>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import { AuthMessage, AuthShell, buttonClass, inputClass } from "@/components/glowflow/auth-shell";
import { isLocale } from "@/lib/i18n";
import { signIn } from "../auth-actions";

export default async function LoginPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string; message?: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const notices = await searchParams;

  return (
    <AuthShell locale={locale} title="Welcome back" subtitle="Sign in to manage your salon, clients, and appointments.">
      <AuthMessage {...notices} />
      <form action={signIn.bind(null, locale)} className="space-y-4">
        <label className="block text-sm font-medium">Email<input className={`${inputClass} mt-2`} name="email" type="email" autoComplete="email" required /></label>
        <label className="block text-sm font-medium">Password<input className={`${inputClass} mt-2`} name="password" type="password" autoComplete="current-password" required /></label>
        <button className={buttonClass} type="submit">Sign in</button>
      </form>
      <div className="mt-5 flex justify-between text-sm">
        <Link className="text-[#9a622f] hover:underline" href={`/${locale}/forgot-password`}>Forgot password?</Link>
        <Link className="font-semibold hover:underline" href={`/${locale}/register`}>Create account</Link>
      </div>
    </AuthShell>
  );
}

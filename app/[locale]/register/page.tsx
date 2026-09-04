import Link from "next/link";
import { notFound } from "next/navigation";

import { AuthMessage, AuthShell, buttonClass, inputClass } from "@/components/glowflow/auth-shell";
import { isLocale } from "@/lib/i18n";
import { signUp } from "../auth-actions";

export default async function RegisterPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const notices = await searchParams;

  return (
    <AuthShell locale={locale} title="Create your salon" subtitle="Start with one secure owner account and a private GlowFlow workspace.">
      <AuthMessage {...notices} />
      <form action={signUp.bind(null, locale)} className="space-y-4">
        <label className="block text-sm font-medium">Your name<input className={`${inputClass} mt-2`} name="full_name" autoComplete="name" minLength={2} required /></label>
        <label className="block text-sm font-medium">Salon name<input className={`${inputClass} mt-2`} name="salon_name" minLength={2} required /></label>
        <label className="block text-sm font-medium">Email<input className={`${inputClass} mt-2`} name="email" type="email" autoComplete="email" required /></label>
        <label className="block text-sm font-medium">Password<input className={`${inputClass} mt-2`} name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <label className="block text-sm font-medium">Currency<select className={`${inputClass} mt-2`} name="currency" defaultValue="EUR"><option value="EUR">EUR €</option><option value="USD">USD $</option></select></label>
        <button className={buttonClass} type="submit">Create GlowFlow account</button>
      </form>
      <p className="mt-5 text-center text-sm">Already registered? <Link className="font-semibold hover:underline" href={`/${locale}/login`}>Sign in</Link></p>
    </AuthShell>
  );
}

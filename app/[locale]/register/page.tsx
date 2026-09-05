import Link from "next/link";
import { notFound } from "next/navigation";

import { AuthMessage, AuthShell, buttonClass, inputClass } from "@/components/glowflow/auth-shell";
import { CountryFields } from "@/components/glowflow/country-fields";
import { isLocale } from "@/lib/i18n";
import { fallbackMarkets, type Market } from "@/lib/markets";
import { createClient } from "@/lib/supabase/server";
import { signUp } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function RegisterPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const notices = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("markets")
    .select("country_code, name_json, supported_locales, default_locale, currency, default_time_zone, supported_time_zones, address_format, tax_config, payment_methods, status")
    .eq("status", "active")
    .order("country_code");

  const markets = data?.length ? (data as Market[]) : fallbackMarkets;

  return (
    <AuthShell locale={locale} title="Create your salon" subtitle="Start with one secure owner account and a private GlowFlow workspace.">
      <AuthMessage {...notices} />
      <form action={signUp.bind(null, locale)} className="space-y-4">
        <label className="block text-sm font-medium">Your name<input className={`${inputClass} mt-2`} name="full_name" autoComplete="name" minLength={2} required /></label>
        <label className="block text-sm font-medium">Salon name<input className={`${inputClass} mt-2`} name="salon_name" minLength={2} required /></label>
        <label className="block text-sm font-medium">Email<input className={`${inputClass} mt-2`} name="email" type="email" autoComplete="email" required /></label>
        <label className="block text-sm font-medium">Password<input className={`${inputClass} mt-2`} name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <CountryFields locale={locale} markets={markets} />
        <button className={buttonClass} type="submit">Create GlowFlow account</button>
      </form>
      <p className="mt-5 text-center text-sm">Already registered? <Link className="font-semibold hover:underline" href={`/${locale}/login`}>Sign in</Link></p>
    </AuthShell>
  );
}

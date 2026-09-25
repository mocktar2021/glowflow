import Link from "next/link";
import { notFound } from "next/navigation";

import { AuthMessage, AuthShell, buttonClass, inputClass } from "@/components/glowflow/auth-shell";
import { CountryFields } from "@/components/glowflow/country-fields";
import { isLocale } from "@/lib/i18n";
import { fallbackMarkets, type Market } from "@/lib/markets";
import { createClient } from "@/lib/supabase/server";
import { authCopy } from "@/lib/auth-copy";
import { signUp } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function RegisterPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const notices = await searchParams;
  const labels = authCopy[locale].register;
  let markets = fallbackMarkets;

  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("markets")
      .select("country_code, name_json, supported_locales, default_locale, currency, default_time_zone, supported_time_zones, address_format, tax_config, payment_methods, status")
      .eq("status", "active")
      .order("country_code");

    if (data?.length) {
      markets = data as Market[];
    }
  }

  return (
    <AuthShell locale={locale} title={labels.title} subtitle={labels.subtitle}>
      <AuthMessage {...notices} />
      <form action={signUp.bind(null, locale)} className="space-y-4">
        <label className="block text-sm font-medium">{labels.name}<input className={`${inputClass} mt-2`} name="full_name" autoComplete="name" minLength={2} required /></label>
        <label className="block text-sm font-medium">{labels.salon}<input className={`${inputClass} mt-2`} name="salon_name" minLength={2} required /></label>
        <label className="block text-sm font-medium">{labels.email}<input className={`${inputClass} mt-2`} name="email" type="email" autoComplete="email" required /></label>
        <label className="block text-sm font-medium">{labels.password}<input className={`${inputClass} mt-2`} name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <CountryFields locale={locale} markets={markets} />
        <button className={buttonClass} type="submit">{labels.submit}</button>
      </form>
      <p className="mt-5 text-center text-sm">{labels.existing} <Link className="font-semibold hover:underline" href={`/${locale}/login`}>{labels.signIn}</Link></p>
    </AuthShell>
  );
}

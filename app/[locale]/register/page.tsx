import Link from "next/link";
import { notFound } from "next/navigation";

import { AuthMessage, AuthShell } from "@/components/glowflow/auth-shell";
import { RegistrationForm } from "@/components/glowflow/registration-form";
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
    <AuthShell locale={locale} title={labels.title} subtitle={labels.subtitle} wide>
      <AuthMessage {...notices} />
      <RegistrationForm locale={locale} markets={markets} action={signUp.bind(null, locale)} />
      <p className="mt-6 text-center text-sm text-muted-foreground">{labels.existing} <Link className="font-semibold text-primary hover:underline" href={`/${locale}/login`}>{labels.signIn}</Link></p>
    </AuthShell>
  );
}

import { notFound } from "next/navigation";

import { GlowFlowIntlProvider } from "@/components/glowflow/i18n-provider";
import { LegalFooter } from "@/components/glowflow/legal-footer";
import { isLocale, messages } from "@/lib/i18n";

export function generateStaticParams() {
  return [{ locale: "fr" }, { locale: "en" }, { locale: "es" }];
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  return (
    <GlowFlowIntlProvider locale={locale} messages={messages[locale]}>
      <div lang={locale}>{children}<LegalFooter locale={locale} /></div>
    </GlowFlowIntlProvider>
  );
}

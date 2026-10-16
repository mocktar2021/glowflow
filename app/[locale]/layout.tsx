import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GlowFlowIntlProvider } from "@/components/glowflow/i18n-provider";
import { LegalFooter } from "@/components/glowflow/legal-footer";
import { isLocale, messages } from "@/lib/i18n";
import "../globals.css";

export const metadata: Metadata = {
  title: {
    default: "GlowFlow",
    template: "%s · GlowFlow",
  },
  description:
    "Booking, client records, deposits, reminders, and checkout for independent beauty professionals.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

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
    <html lang={locale}>
      <body className="min-h-screen antialiased">
        <GlowFlowIntlProvider locale={locale} messages={messages[locale]}>
          {children}<LegalFooter locale={locale} />
        </GlowFlowIntlProvider>
      </body>
    </html>
  );
}

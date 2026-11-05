import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GlowFlowIntlProvider } from "@/components/glowflow/i18n-provider";
import { LegalFooter } from "@/components/glowflow/legal-footer";
import { PwaRegistration } from "@/components/glowflow/pwa-registration";
import { isLocale, messages } from "@/lib/i18n";
import "../globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.VERCEL_ENV === "production"
      ? "https://glowflow.mocktar.com"
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000",
  ),
  title: {
    default: "GlowFlow",
    template: "%s · GlowFlow",
  },
  description:
    "Booking, client records, deposits, reminders, and checkout for independent beauty professionals.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: "GlowFlow",
    images: [{ url: "/og-glowflow.png", width: 1200, height: 630, alt: "GlowFlow" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-glowflow.png"],
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
          <PwaRegistration />{children}<LegalFooter locale={locale} />
        </GlowFlowIntlProvider>
      </body>
    </html>
  );
}

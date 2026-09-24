import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage } from "@/components/glowflow/legal-page";
import { isLocale } from "@/lib/i18n";
export const metadata: Metadata = { title: "Support" };
export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) { const { locale } = await params; if (!isLocale(locale)) notFound(); return <LegalPage locale={locale} document="support" />; }

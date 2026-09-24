import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage } from "@/components/glowflow/legal-page";
import { isLocale } from "@/lib/i18n";
export const metadata: Metadata = { title: "Terms" };
export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) { const { locale } = await params; if (!isLocale(locale)) notFound(); return <LegalPage locale={locale} document="terms" />; }

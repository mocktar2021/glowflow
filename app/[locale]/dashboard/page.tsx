import { notFound } from "next/navigation";

import { DashboardShell } from "@/components/glowflow/dashboard-shell";
import { isLocale } from "@/lib/i18n";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  return <DashboardShell locale={locale} />;
}

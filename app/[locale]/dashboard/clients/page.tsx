import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceShell } from "@/components/glowflow/workspace-shell";
import { clientMember, findClients } from "@/lib/clients";
import { isLocale } from "@/lib/i18n";
import { ClientForm } from "./client-form";
import { ClientSearch } from "./client-search";
import { copy } from "./copy";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function ClientsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { supabase, tenantId } = await clientMember(locale);
  const rows = await findClients(supabase, tenantId, "");
  const labels = copy[locale];
  return <WorkspaceShell locale={locale} active="clients"><main className="min-h-screen bg-background px-5 pb-28 pt-10 text-foreground sm:px-8 lg:pb-10">
    <div className="mx-auto max-w-5xl">
      <Link href={`/${locale}/dashboard`} className="text-sm font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-primary">{labels.back}</Link>
      <h1 className="mt-5 font-display text-4xl font-medium sm:text-5xl">{labels.directory}</h1>
      <p className="mt-2 text-muted-foreground">{labels.intro}</p>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <ClientSearch locale={locale} initialRows={rows} />
        <ClientForm locale={locale} />
      </div>
    </div>
  </main></WorkspaceShell>;
}

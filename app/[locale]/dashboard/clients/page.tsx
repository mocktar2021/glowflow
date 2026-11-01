import Link from "next/link";
import { notFound } from "next/navigation";

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
  return <main className="min-h-screen bg-[#faf9f6] px-5 py-10 text-slate-950 dark:bg-[#0f1115] dark:text-stone-50 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <Link href={`/${locale}/dashboard`} className="text-sm font-semibold text-[#925723] underline dark:text-[#e8bb82]">{labels.back}</Link>
      <h1 className="mt-5 text-3xl font-semibold">{labels.directory}</h1>
      <p className="mt-2 text-slate-600 dark:text-stone-300">{labels.intro}</p>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <ClientSearch locale={locale} initialRows={rows} />
        <ClientForm locale={locale} />
      </div>
    </div>
  </main>;
}

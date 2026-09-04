import { LogOut } from "lucide-react";
import { notFound } from "next/navigation";

import { DashboardShell } from "@/components/glowflow/dashboard-shell";
import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { signOut } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  await requireUser(locale);

  return (
    <>
      <DashboardShell locale={locale} />
      <form action={signOut.bind(null, locale)} className="fixed bottom-24 right-4 z-50 md:bottom-5">
        <button
          type="submit"
          className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-lg hover:bg-slate-50 dark:border-white/10 dark:bg-[#202228] dark:text-stone-200"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </form>
    </>
  );
}

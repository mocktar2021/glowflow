import Link from "next/link";
import { Sparkles } from "lucide-react";

import type { Locale } from "@/lib/i18n";

const copy = {
  fr: { back: "Retour à la réservation", secure: "Votre espace salon sécurisé" },
  en: { back: "Back to booking", secure: "Your secure salon workspace" },
  es: { back: "Volver a reservas", secure: "Tu espacio de salón seguro" },
} satisfies Record<Locale, { back: string; secure: string }>;

export function AuthShell({
  locale,
  title,
  subtitle,
  children,
}: {
  locale: Locale;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f3ece2] p-4 dark:bg-[#101216]">
      <section className="w-full max-w-md rounded-[2rem] border border-[#e4d6c5] bg-[#faf9f6] p-6 shadow-[0_24px_80px_rgba(48,32,18,0.12)] dark:border-white/10 dark:bg-[#17191e] sm:p-8">
        <Link href={`/${locale}/book/atelier-lumiere`} className="mb-8 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-slate-950 text-[#e7b779] dark:bg-[#e7b779] dark:text-slate-950">
            <Sparkles className="size-5" />
          </span>
          <span>
            <strong className="block text-xl tracking-[-0.04em]">GlowFlow</strong>
            <span className="text-xs text-slate-500 dark:text-stone-400">{copy[locale].secure}</span>
          </span>
        </Link>
        <h1 className="text-3xl font-semibold tracking-[-0.05em]">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-stone-400">{subtitle}</p>
        <div className="mt-7">{children}</div>
        <Link href={`/${locale}/book/atelier-lumiere`} className="mt-7 block text-center text-sm text-slate-500 hover:text-slate-950 dark:hover:text-white">
          {copy[locale].back}
        </Link>
      </section>
    </main>
  );
}

export function AuthMessage({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return (
    <p className={`mb-5 rounded-xl border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>
      {error ?? message}
    </p>
  );
}

export const inputClass = "h-12 w-full rounded-xl border border-[#dfd2c1] bg-white px-4 text-sm outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5";
export const buttonClass = "h-12 w-full rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-[#e7b779] dark:text-slate-950";

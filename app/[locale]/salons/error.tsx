"use client";

import { usePathname } from "next/navigation";

const messages = {
  fr: {
    title: "La recherche est temporairement indisponible",
    text: "Réessayez dans quelques instants.",
    retry: "Réessayer",
  },
  en: {
    title: "Search is temporarily unavailable",
    text: "Please try again in a moment.",
    retry: "Try again",
  },
  es: {
    title: "La búsqueda no está disponible temporalmente",
    text: "Inténtalo de nuevo en unos instantes.",
    retry: "Intentar de nuevo",
  },
} as const;

export default function SalonSearchError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const locale = pathname.split("/")[1];
  const copy = locale === "en" || locale === "es" ? messages[locale] : messages.fr;

  return (
    <main className="grid min-h-screen place-items-center bg-[#faf9f6] p-4 text-slate-950 dark:bg-[#101216] dark:text-stone-100">
      <section className="w-full max-w-lg rounded-[1.75rem] border border-rose-200 bg-white p-8 text-center dark:border-rose-900/50 dark:bg-[#17191e]">
        <h1 className="text-2xl font-semibold">{copy.title}</h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-stone-300">{copy.text}</p>
        <button type="button" onClick={reset} className="mt-6 h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white dark:bg-[#e7b779] dark:text-slate-950">
          {copy.retry}
        </button>
      </section>
    </main>
  );
}

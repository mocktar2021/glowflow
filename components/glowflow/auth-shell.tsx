import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { BrandLogo } from "@/components/glowflow/brand-logo";
import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import type { Locale } from "@/lib/i18n";

const copy = {
  fr: {
    home: "Retour à l’accueil",
    browse: "Explorer les salons",
    secure: "Votre espace salon",
    asideTitle: "Plus de place pour votre métier.",
    illustration: "Image illustrative, créée pour GlowFlow",
  },
  en: {
    home: "Back to home",
    browse: "Explore salons",
    secure: "Your salon workspace",
    asideTitle: "More room for your craft.",
    illustration: "Illustrative image created for GlowFlow",
  },
  es: {
    home: "Volver al inicio",
    browse: "Explorar salones",
    secure: "Tu espacio de salón",
    asideTitle: "Más espacio para tu talento.",
    illustration: "Imagen ilustrativa creada para GlowFlow",
  },
} satisfies Record<Locale, { home: string; browse: string; secure: string; asideTitle: string; illustration: string }>;

export function AuthShell({
  locale,
  title,
  subtitle,
  children,
  showLanguageSwitcher = true,
  wide = false,
}: {
  locale: Locale;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  showLanguageSwitcher?: boolean;
  wide?: boolean;
}) {
  const labels = copy[locale];
  return (
    <main className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
      <section className="flex min-w-0 flex-col px-5 py-6 sm:px-10 sm:py-8 lg:min-h-screen lg:px-12 xl:px-16" aria-labelledby="auth-title">
        <header className="flex items-center justify-between gap-4">
          <Link href={`/${locale}`} className="inline-flex min-h-11 items-center rounded-md text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary" aria-label={`GlowFlow, ${labels.home}`}>
            <BrandLogo className="h-9 w-32 sm:w-36" />
          </Link>
          {showLanguageSwitcher ? <LanguageSwitcher locale={locale} /> : null}
        </header>

        <div className={`mx-auto w-full flex-1 py-12 sm:py-16 lg:flex lg:flex-col lg:justify-center ${wide ? "max-w-2xl" : "max-w-lg"}`}>
          <Link href={`/${locale}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><ArrowLeft className="size-4" aria-hidden="true" />{labels.home}</Link>
          <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-champagne-deep dark:text-[#d9b48f]">{labels.secure}</p>
          <h1 id="auth-title" className="mt-3 max-w-xl font-display text-5xl font-medium leading-[1.05] sm:text-6xl">{title}</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">{subtitle}</p>
          <div className="mt-8 rounded-[1.75rem] border border-border bg-card p-6 shadow-[0_18px_55px_-36px_rgba(94,52,69,0.35)] sm:p-8">{children}</div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-sm text-muted-foreground">
          <span>© {new Date().getUTCFullYear()} GlowFlow</span>
          <Link href={`/${locale}/salons`} className="min-h-11 py-3 font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">{labels.browse}</Link>
        </footer>
      </section>

      <aside className="relative hidden min-h-screen overflow-hidden bg-[#2a2129] text-[#f6efea] lg:block" aria-label={labels.illustration}>
        <Image src="/brand/illustrative-manicure.jpg" alt="" fill priority sizes="40vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#2a2129]/95 via-[#2a2129]/10 to-[#2a2129]/10" />
        <div className="absolute inset-x-0 bottom-0 p-10 xl:p-14">
          <p className="max-w-md font-display text-5xl font-medium leading-tight">{labels.asideTitle}</p>
          <p className="mt-5 text-sm text-[#f6efea]">{labels.illustration}</p>
        </div>
      </aside>
    </main>
  );
}

export function AuthMessage({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return (
    <p role={error ? "alert" : "status"} className={`mb-5 rounded-xl border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>
      {error ?? message}
    </p>
  );
}

export const inputClass = "min-h-12 w-full rounded-[0.9rem] border border-input bg-background px-4 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20";
export const buttonClass = "min-h-12 w-full rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:opacity-50";

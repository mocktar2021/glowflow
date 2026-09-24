import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";

import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { legalCopy, legalEffectiveDate, supportEmail } from "@/lib/legal-content";
import type { Locale } from "@/lib/i18n";

export type LegalDocumentKind = "privacy" | "terms" | "support";

export function LegalPage({ locale, document }: { locale: Locale; document: LegalDocumentKind }) {
  const copy = legalCopy[locale];
  const content = copy.documents[document];
  return (
    <main className="min-h-screen bg-[#f7f2eb] text-slate-950 dark:bg-[#101216] dark:text-white">
      <header className="border-b border-[#e4d6c5] bg-white/90 dark:border-white/10 dark:bg-[#17191e]/90">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Link href={`/${locale}/salons`} className="flex items-center gap-3 font-semibold"><Sparkles className="size-5 text-[#a56d37]" />GlowFlow</Link>
          <LanguageSwitcher locale={locale} />
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <Link href={`/${locale}/salons`} className="inline-flex items-center gap-2 text-sm font-medium text-[#8b572a] hover:underline"><ArrowLeft className="size-4" />{copy.back}</Link>
        <p className="mt-10 text-sm font-semibold uppercase tracking-[0.18em] text-[#9a622f]">GlowFlow</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">{content.title}</h1>
        <p className="mt-5 text-lg leading-8 text-slate-600 dark:text-stone-300">{content.summary}</p>
        <p className="mt-4 text-sm text-slate-500">{copy.effective} {legalEffectiveDate}</p>
        <div className="mt-12 space-y-10">
          {content.sections.map((section) => <section key={section.heading}><h2 className="text-2xl font-semibold tracking-[-0.03em]">{section.heading}</h2><div className="mt-4 space-y-4 text-base leading-7 text-slate-700 dark:text-stone-300">{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></section>)}
        </div>
        <div className="mt-12 rounded-2xl border border-[#dfd2c1] bg-white p-5 text-sm dark:border-white/10 dark:bg-white/5"><p>{copy.operator}</p><a className="mt-2 inline-block font-semibold text-[#8b572a] hover:underline" href={`mailto:${supportEmail}`}>{supportEmail}</a></div>
      </article>
    </main>
  );
}

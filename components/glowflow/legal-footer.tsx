import Link from "next/link";

import { legalCopy, supportEmail } from "@/lib/legal-content";
import type { Locale } from "@/lib/i18n";

export function LegalFooter({ locale }: { locale: Locale }) {
  const copy = legalCopy[locale];
  return <footer className="border-t border-border bg-background px-5 py-6 text-sm text-muted-foreground"><div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p>© 2026 Mocktar Technologies · GlowFlow</p><nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2"><Link href={`/${locale}/privacy`} className="hover:text-primary hover:underline">{copy.privacy}</Link><Link href={`/${locale}/terms`} className="hover:text-primary hover:underline">{copy.terms}</Link><Link href={`/${locale}/support`} className="hover:text-primary hover:underline">{copy.support}</Link><a href={`mailto:${supportEmail}`} className="hover:text-primary hover:underline">{supportEmail}</a></nav></div></footer>;
}

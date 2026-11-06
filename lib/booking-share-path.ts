import type { Locale } from "@/lib/i18n";

/** Relative public link stays correct on the QA host and after beauty cutover. */
export function bookingSharePath(locale: Locale, salonSlug: string): string {
  return `/${locale}/book/${encodeURIComponent(salonSlug)}`;
}

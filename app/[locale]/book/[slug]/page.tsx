import { notFound } from "next/navigation";

import { BookingFlow } from "@/components/glowflow/booking-flow";
import { isLocale } from "@/lib/i18n";

export default async function BookingPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  return <BookingFlow locale={locale} salonSlug={slug} />;
}

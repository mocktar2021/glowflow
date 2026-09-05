import { notFound } from "next/navigation";

import { BookingFlow } from "@/components/glowflow/booking-flow";
import { LiveBookingFlow } from "@/components/glowflow/live-booking-flow";
import { isLocale } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Service = {
  id: string;
  title_json: Record<string, string>;
  duration_minutes: number;
  price: number;
  deposit_amount: number;
  currency: string;
};

export default async function BookingPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    return <BookingFlow locale={locale} salonSlug={slug} />;
  }

  const supabase = createAdminClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id,name,slug,city,currency,time_zone,is_booking_enabled")
    .eq("slug", slug)
    .eq("is_booking_enabled", true)
    .single();

  if (!tenant) notFound();

  const { data: rawServices } = await supabase
    .from("services")
    .select("id,title_json,duration_minutes,price,deposit_amount,currency")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true)
    .order("created_at");

  const services = (rawServices ?? []) as Service[];
  if (!services.length) notFound();

  return (
    <LiveBookingFlow
      locale={locale}
      salon={{
        name: tenant.name,
        slug: tenant.slug,
        city: tenant.city,
        currency: tenant.currency,
        timeZone: tenant.time_zone,
      }}
      services={services}
    />
  );
}

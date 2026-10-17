import { notFound } from "next/navigation";

import { BookingFlow } from "@/components/glowflow/booking-flow";
import { LiveBookingFlow } from "@/components/glowflow/live-booking-flow";
import { SandboxPaymentStatusPanel } from "@/components/glowflow/sandbox-payment-status";
import { isLocale } from "@/lib/i18n";
import { sandboxOwner } from "@/lib/stripe-sandbox";
import { sandboxDepositConfiguration } from "@/lib/stripe-deposits-config";
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
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ sandbox?: string; sandboxReservation?: string; service?: string | string[] }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  if (query.service !== undefined && (typeof query.service !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.service))) notFound();
  const initialServiceId = typeof query.service === "string" ? query.service.toLowerCase() : undefined;
  const sandbox = query.sandbox === "1" || typeof query.sandboxReservation === "string";
  let sandboxTenantId: string | null = null;
  if (sandbox) {
    if (!sandboxDepositConfiguration(process.env)) notFound();
    const owner = await sandboxOwner();
    if (!owner) notFound();
    const { data: ownedSalon } = await owner.supabase.from("tenants").select("slug").eq("id", owner.tenant.id).single();
    if (!ownedSalon || ownedSalon.slug !== slug) notFound();
    sandboxTenantId = owner.tenant.id;
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    if (slug !== "atelier-belle" || initialServiceId) notFound();
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
  if (sandbox && tenant.id !== sandboxTenantId) notFound();
  let publicSalonName = tenant.name;
  if (!sandbox) {
    const { data: publishedProfile } = await supabase
      .from("salon_public_profiles")
      .select("tenant_id,business_name")
      .eq("tenant_id", tenant.id)
      .eq("is_published", true)
      .maybeSingle();
    if (!publishedProfile) notFound();
    publicSalonName = publishedProfile.business_name;
  }
  if (sandbox && query.sandboxReservation) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.sandboxReservation)) notFound();
    return <SandboxPaymentStatusPanel locale={locale} salonSlug={slug} reservationId={query.sandboxReservation} />;
  }

  const { data: rawServices } = await supabase
    .from("services")
    .select("id,title_json,duration_minutes,price,deposit_amount,currency")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true)
    .order("created_at");

  const services = (rawServices ?? []) as Service[];
  if (!services.length) notFound();
  if (initialServiceId && !services.some((service) => service.id === initialServiceId)) notFound();

  return (
    <LiveBookingFlow
      key={`${tenant.id}:${initialServiceId ?? "default"}:${sandbox}`}
      initialServiceId={initialServiceId}
      locale={locale}
      sandbox={sandbox}
      salon={{
        name: publicSalonName,
        slug: tenant.slug,
        city: tenant.city,
        currency: tenant.currency,
        timeZone: tenant.time_zone,
      }}
      services={services}
    />
  );
}

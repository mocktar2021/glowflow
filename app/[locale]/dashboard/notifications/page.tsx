import { notFound, redirect } from "next/navigation";
import { NotificationTemplatePreview } from "@/components/glowflow/notification-template-preview";
import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { supabase, userId } = await requireUser(locale);
  const { data: tenant, error } = await supabase.from("tenants")
    .select("id").eq("owner_id", userId).single();
  if (error || !tenant) redirect(`/${locale}/dashboard`);
  return <NotificationTemplatePreview locale={locale} />;
}

"use server";

import { redirect, notFound } from "next/navigation";

import { requireUser, safeLocale } from "@/lib/auth";
import { queueStaffInvitationDelivery } from "@/lib/staff-invitation-delivery";
import { staffInvitationManagementEnabled } from "@/lib/staff-invitations";

const emailPattern = /^[^\s@]+@[^\s@]+$/;
const uuidPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

export async function requestStaffInvitation(localeValue: string, formData: FormData) {
  if (!staffInvitationManagementEnabled()) notFound();
  const locale = safeLocale(localeValue);
  const { supabase, userId } = await requireUser(locale);
  const { data: membership, error: membershipError } = await supabase
    .from("users").select("tenant_id,role").eq("id", userId).single();
  if (membershipError || !membership?.tenant_id || membership.role !== "owner") notFound();

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants").select("owner_id").eq("id", membership.tenant_id).single();
  if (tenantError || tenant?.owner_id !== userId) notFound();

  const email = String(formData.get("email") ?? "").trim();
  const requestKey = String(formData.get("request_key") ?? "");
  if (email.length < 3 || email.length > 320 || !emailPattern.test(email)
      || !uuidPattern.test(requestKey)) {
    redirect(`/${locale}/dashboard/team/invitations?error=unavailable`);
  }

  let queued = false;
  try {
    queued = (await queueStaffInvitationDelivery(email, requestKey)).status === "queued";
  } catch {
    // Keep provider, database, and recipient details out of URLs and logs.
  }
  redirect(`/${locale}/dashboard/team/invitations?${queued ? "requested=1" : "error=unavailable"}`);
}

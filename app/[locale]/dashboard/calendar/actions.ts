"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";
import { isAppointmentConflict } from "@/lib/bookings/conflicts";

const uuid = z.string().uuid();
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);
const dateValue = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const viewValue = z.enum(["day", "week"]);

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function navigation(formData: FormData) {
  const date = dateValue.safeParse(text(formData, "calendar_date"));
  const view = viewValue.safeParse(text(formData, "calendar_view"));
  return {
    date: date.success ? date.data : new Date().toISOString().slice(0, 10),
    view: view.success ? view.data : "day",
  };
}

function destination(locale: Locale, date: string, view: string, result: string): never {
  redirect(`/${locale}/dashboard/calendar?date=${encodeURIComponent(date)}&view=${view}&${result}`);
}

async function memberContext(locale: Locale, formData: FormData) {
  const nav = navigation(formData);
  const { supabase, userId } = await requireUser(locale);
  const { data: member } = await supabase
    .from("users")
    .select("tenant_id, role")
    .eq("id", userId)
    .single();

  if (!member?.tenant_id || !["owner", "staff"].includes(member.role)) {
    destination(locale, nav.date, nav.view, "error=member_required");
  }

  return { supabase, nav, tenantId: member.tenant_id };
}

export async function createAppointment(locale: Locale, formData: FormData) {
  const values = z.object({
    clientId: uuid,
    serviceId: uuid,
    staffId: uuid,
    localStart: localDateTime,
    requestKey: uuid,
  }).safeParse({
    clientId: text(formData, "client_id"),
    serviceId: text(formData, "service_id"),
    staffId: text(formData, "staff_id"),
    localStart: text(formData, "local_start"),
    requestKey: text(formData, "request_key"),
  });
  const nav = navigation(formData);
  if (!values.success) destination(locale, nav.date, nav.view, "error=invalid_appointment");

  const { supabase } = await memberContext(locale, formData);
  const { error } = await supabase.rpc("create_calendar_appointment", {
    target_client_id: values.data.clientId,
    target_service_id: values.data.serviceId,
    target_staff_id: values.data.staffId,
    local_start: values.data.localStart.replace("T", " "),
    request_key: values.data.requestKey,
  });

  if (error) {
    destination(locale, nav.date, nav.view, isAppointmentConflict(error) ? "error=conflict" : "error=create_failed");
  }

  revalidatePath(`/${locale}/dashboard/calendar`);
  destination(locale, nav.date, nav.view, "saved=created");
}

export async function rescheduleAppointment(locale: Locale, formData: FormData) {
  const values = z.object({
    appointmentId: uuid,
    localStart: localDateTime,
  }).safeParse({
    appointmentId: text(formData, "appointment_id"),
    localStart: text(formData, "local_start"),
  });
  const nav = navigation(formData);
  if (!values.success) destination(locale, nav.date, nav.view, "error=invalid_appointment");

  const { supabase } = await memberContext(locale, formData);
  const { error } = await supabase.rpc("reschedule_calendar_appointment", {
    target_appointment_id: values.data.appointmentId,
    local_start: values.data.localStart.replace("T", " "),
  });

  if (error) {
    destination(locale, nav.date, nav.view, isAppointmentConflict(error) ? "error=conflict" : "error=reschedule_failed");
  }

  revalidatePath(`/${locale}/dashboard/calendar`);
  destination(locale, nav.date, nav.view, "saved=rescheduled");
}

export async function cancelAppointment(locale: Locale, formData: FormData) {
  const appointmentId = text(formData, "appointment_id");
  const nav = navigation(formData);
  if (!uuid.safeParse(appointmentId).success) {
    destination(locale, nav.date, nav.view, "error=invalid_appointment");
  }

  const { supabase } = await memberContext(locale, formData);
  const { error } = await supabase.rpc("cancel_calendar_appointment", {
    target_appointment_id: appointmentId,
  });

  if (error) destination(locale, nav.date, nav.view, "error=cancel_failed");
  revalidatePath(`/${locale}/dashboard/calendar`);
  destination(locale, nav.date, nav.view, "saved=canceled");
}


export async function createQuickClient(locale: Locale, formData: FormData) {
  const values = z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40),
    email: z.union([z.literal(""), z.string().trim().email().max(160)]),
  }).safeParse({
    fullName: text(formData, "full_name"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
  });
  const nav = navigation(formData);
  if (!values.success) destination(locale, nav.date, nav.view, "error=invalid_client");

  const { supabase, tenantId } = await memberContext(locale, formData);

  const { error } = await supabase.from("clients").insert({
    tenant_id: tenantId,
    full_name: values.data.fullName,
    phone: values.data.phone || null,
    email: values.data.email || null,
    preferred_locale: locale,
  });

  if (error) destination(locale, nav.date, nav.view, "error=client_failed");
  revalidatePath(`/${locale}/dashboard/calendar`);
  destination(locale, nav.date, nav.view, "saved=client");
}

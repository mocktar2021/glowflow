"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";

const uuid = z.string().uuid();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const weekday = z.coerce.number().int().min(0).max(6);
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function destination(locale: Locale, result: string): never {
  redirect(`/${locale}/dashboard/availability?${result}`);
}

async function ownerContext(locale: Locale) {
  const { supabase, userId } = await requireUser(locale);
  const { data: owner } = await supabase
    .from("users")
    .select("tenant_id, role")
    .eq("id", userId)
    .single();

  if (!owner?.tenant_id || owner.role !== "owner") {
    destination(locale, "error=owner_required");
  }

  return { supabase, tenantId: owner.tenant_id };
}

export async function saveStaffHours(locale: Locale, formData: FormData) {
  const parsed = z.object({
    staffId: uuid,
    weekday,
    startLocal: time,
    endLocal: time,
  }).safeParse({
    staffId: text(formData, "staff_id"),
    weekday: text(formData, "weekday"),
    startLocal: text(formData, "start_local"),
    endLocal: text(formData, "end_local"),
  });

  if (!parsed.success || parsed.data.endLocal <= parsed.data.startLocal) {
    destination(locale, "error=invalid_hours");
  }

  const { supabase, tenantId } = await ownerContext(locale);
  const { error } = await supabase.from("staff_working_hours").upsert({
    tenant_id: tenantId,
    staff_id: parsed.data.staffId,
    weekday: parsed.data.weekday,
    start_local: parsed.data.startLocal,
    end_local: parsed.data.endLocal,
    is_enabled: formData.get("is_enabled") === "on",
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,staff_id,weekday" });

  if (error) destination(locale, "error=save_failed");
  revalidatePath(`/${locale}/dashboard/availability`);
  destination(locale, "saved=staff");
}

export async function saveStationHours(locale: Locale, formData: FormData) {
  const parsed = z.object({
    stationName: z.string().trim().min(1).max(120),
    weekday,
    startLocal: time,
    endLocal: time,
  }).safeParse({
    stationName: text(formData, "station_name"),
    weekday: text(formData, "weekday"),
    startLocal: text(formData, "start_local"),
    endLocal: text(formData, "end_local"),
  });

  if (!parsed.success || parsed.data.endLocal <= parsed.data.startLocal) {
    destination(locale, "error=invalid_hours");
  }

  const { supabase, tenantId } = await ownerContext(locale);
  const { error } = await supabase.from("station_working_hours").upsert({
    tenant_id: tenantId,
    station_name: parsed.data.stationName,
    weekday: parsed.data.weekday,
    start_local: parsed.data.startLocal,
    end_local: parsed.data.endLocal,
    is_enabled: formData.get("is_enabled") === "on",
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,station_name,weekday" });

  if (error) destination(locale, "error=save_failed");
  revalidatePath(`/${locale}/dashboard/availability`);
  destination(locale, "saved=station");
}

export async function addScheduleException(locale: Locale, formData: FormData) {
  const parsed = z.object({
    staffId: uuid,
    kind: z.enum(["break", "time_off"]),
    localStart: localDateTime,
    localEnd: localDateTime,
    note: z.string().trim().max(240),
  }).safeParse({
    staffId: text(formData, "staff_id"),
    kind: text(formData, "kind"),
    localStart: text(formData, "local_start"),
    localEnd: text(formData, "local_end"),
    note: text(formData, "note"),
  });

  if (!parsed.success || parsed.data.localEnd <= parsed.data.localStart) {
    destination(locale, "error=invalid_exception");
  }

  const { supabase } = await ownerContext(locale);
  const { error } = await supabase.rpc("create_staff_schedule_exception", {
    target_staff_id: parsed.data.staffId,
    exception_kind: parsed.data.kind,
    local_start: parsed.data.localStart.replace("T", " "),
    local_end: parsed.data.localEnd.replace("T", " "),
    note_text: parsed.data.note || null,
  });

  if (error) destination(locale, "error=save_failed");
  revalidatePath(`/${locale}/dashboard/availability`);
  destination(locale, "saved=exception");
}

export async function deleteScheduleException(locale: Locale, formData: FormData) {
  const exceptionId = text(formData, "exception_id");
  if (!uuid.safeParse(exceptionId).success) destination(locale, "error=invalid_exception");

  const { supabase, tenantId } = await ownerContext(locale);
  const { error } = await supabase
    .from("staff_schedule_exceptions")
    .delete()
    .eq("id", exceptionId)
    .eq("tenant_id", tenantId);

  if (error) destination(locale, "error=delete_failed");
  revalidatePath(`/${locale}/dashboard/availability`);
  destination(locale, "saved=deleted");
}

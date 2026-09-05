"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";

const uuid = z.string().uuid();
const optionalUuid = z.union([z.literal(""), uuid]);

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function destination(locale: Locale, result: string): never {
  redirect(`/${locale}/dashboard/walk-ins?${result}`);
}

async function queueContext(locale: Locale) {
  const { supabase, userId } = await requireUser(locale);
  const { data: member } = await supabase
    .from("users")
    .select("tenant_id,role")
    .eq("id", userId)
    .single();

  if (!member?.tenant_id || !["owner", "staff"].includes(member.role)) {
    destination(locale, "error=member_required");
  }

  return { supabase, tenantId: member.tenant_id };
}

function complete(locale: Locale, saved: string): never {
  revalidatePath(`/${locale}/dashboard/walk-ins`);
  revalidatePath(`/${locale}/dashboard`);
  destination(locale, `saved=${saved}`);
}

export async function addWalkIn(locale: Locale, formData: FormData) {
  const parsed = z.object({
    clientName: z.string().trim().min(2).max(120),
    serviceId: uuid,
    staffId: optionalUuid,
    stationName: z.string().trim().max(80),
    estimatedWait: z.coerce.number().int().min(0).max(720),
  }).safeParse({
    clientName: value(formData, "client_name"),
    serviceId: value(formData, "service_id"),
    staffId: value(formData, "staff_id"),
    stationName: value(formData, "station_name"),
    estimatedWait: value(formData, "estimated_wait_minutes"),
  });

  if (!parsed.success) destination(locale, "error=invalid");
  const { supabase } = await queueContext(locale);
  const { error } = await supabase.rpc("enqueue_walk_in", {
    target_client_name: parsed.data.clientName,
    target_service_id: parsed.data.serviceId,
    target_staff_id: parsed.data.staffId || null,
    target_station_name: parsed.data.stationName,
    target_estimated_wait_minutes: parsed.data.estimatedWait,
  });

  if (error) destination(locale, "error=add_failed");
  complete(locale, "added");
}

export async function moveWalkIn(locale: Locale, formData: FormData) {
  const parsed = z.object({
    id: uuid,
    direction: z.coerce.number().int().refine((item) => item === -1 || item === 1),
  }).safeParse({
    id: value(formData, "walk_in_id"),
    direction: value(formData, "direction"),
  });

  if (!parsed.success) destination(locale, "error=invalid");
  const { supabase } = await queueContext(locale);
  const { error } = await supabase.rpc("move_walk_in", {
    target_walk_in_id: parsed.data.id,
    direction: parsed.data.direction,
  });

  if (error) destination(locale, "error=move_failed");
  complete(locale, "reordered");
}

export async function assignWalkIn(locale: Locale, formData: FormData) {
  const parsed = z.object({
    id: uuid,
    staffId: optionalUuid,
    stationName: z.string().trim().max(80),
    estimatedWait: z.coerce.number().int().min(0).max(720),
  }).safeParse({
    id: value(formData, "walk_in_id"),
    staffId: value(formData, "staff_id"),
    stationName: value(formData, "station_name"),
    estimatedWait: value(formData, "estimated_wait_minutes"),
  });

  if (!parsed.success) destination(locale, "error=invalid");
  const { supabase } = await queueContext(locale);
  const { error } = await supabase.rpc("assign_walk_in", {
    target_walk_in_id: parsed.data.id,
    target_staff_id: parsed.data.staffId || null,
    target_station_name: parsed.data.stationName,
    target_estimated_wait_minutes: parsed.data.estimatedWait,
  });

  if (error) destination(locale, "error=assign_failed");
  complete(locale, "assigned");
}

export async function setWalkInStatus(locale: Locale, formData: FormData) {
  const parsed = z.object({
    id: uuid,
    status: z.enum(["waiting", "ready", "in_service", "completed", "removed"]),
  }).safeParse({
    id: value(formData, "walk_in_id"),
    status: value(formData, "status"),
  });

  if (!parsed.success) destination(locale, "error=invalid");
  const { supabase } = await queueContext(locale);
  const { error } = await supabase.rpc("set_walk_in_status", {
    target_walk_in_id: parsed.data.id,
    target_status: parsed.data.status,
  });

  if (error) destination(locale, "error=status_failed");
  complete(locale, parsed.data.status);
}

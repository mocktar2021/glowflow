"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";

const uuid = z.string().uuid();
const serviceSchema = z.object({
  titleFr: z.string().trim().min(2).max(120),
  titleEn: z.string().trim().min(2).max(120),
  titleEs: z.string().trim().min(2).max(120),
  category: z.enum(["hair", "nails", "other"]),
  durationMinutes: z.coerce.number().int().min(5).max(720),
  sanitationBufferMinutes: z.coerce.number().int().min(0).max(120),
  price: z.string().regex(/^\d+(?:[.,]\d{1,2})?$/),
  deposit: z.string().regex(/^\d+(?:[.,]\d{1,2})?$/),
  stationName: z.string().trim().max(120),
});

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function moneyToMinor(value: string, currency: string) {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  let normalized = value.trim().replace(/\\s/g, "");

  for (const token of [symbol, currency].filter(Boolean)) {
    if (normalized.startsWith(token)) normalized = normalized.slice(token.length);
    if (normalized.endsWith(token)) normalized = normalized.slice(0, -token.length);
  }

  if (!/^\\d+(?:[.,]\\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimals = ""] = normalized.replace(",", ".").split(".");
  const minor = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

function destination(locale: Locale, result: string): never {
  redirect(`/${locale}/dashboard/services?${result}`);
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

  const { data: tenant } = await supabase
    .from("tenants")
    .select("currency")
    .eq("id", owner.tenant_id)
    .single();

  if (!tenant) destination(locale, "error=workspace_missing");
  return { supabase, tenantId: owner.tenant_id, currency: tenant.currency };
}

function parseService(formData: FormData, currency: string) {
  const parsed = serviceSchema.safeParse({
    titleFr: text(formData, "title_fr"),
    titleEn: text(formData, "title_en"),
    titleEs: text(formData, "title_es"),
    category: text(formData, "category"),
    durationMinutes: text(formData, "duration_minutes"),
    sanitationBufferMinutes: text(formData, "sanitation_buffer_minutes"),
    price: text(formData, "price"),
    deposit: text(formData, "deposit"),
    stationName: text(formData, "station_name"),
  });

  if (!parsed.success) return null;
  const price = moneyToMinor(parsed.data.price, currency);
  const depositAmount = moneyToMinor(parsed.data.deposit, currency);
  if (price === null || depositAmount === null || depositAmount > price) return null;

  return {
    title_json: { fr: parsed.data.titleFr, en: parsed.data.titleEn, es: parsed.data.titleEs },
    category: parsed.data.category,
    duration_minutes: parsed.data.durationMinutes,
    sanitation_buffer_minutes: parsed.data.sanitationBufferMinutes,
    price,
    deposit_amount: depositAmount,
    station_name: parsed.data.stationName || null,
  };
}

function selectedStaff(formData: FormData) {
  return formData.getAll("staff_ids").map(String).filter((value) => uuid.safeParse(value).success);
}

async function replaceEligibleStaff(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  tenantId: string,
  serviceId: string,
  staffIds: string[],
) {
  const { error: deleteError } = await supabase
    .from("service_staff")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("service_id", serviceId);
  if (deleteError) return deleteError;

  if (!staffIds.length) return null;
  const { error } = await supabase.from("service_staff").insert(
    staffIds.map((staffId) => ({ service_id: serviceId, staff_id: staffId, tenant_id: tenantId })),
  );
  return error;
}

export async function createService(locale: Locale, formData: FormData) {
  const { supabase, tenantId, currency } = await ownerContext(locale);
  const values = parseService(formData, currency);
  if (!values) destination(locale, "error=invalid_service");
  const { data: service, error } = await supabase
    .from("services")
    .insert({ ...values, tenant_id: tenantId, currency, is_active: true })
    .select("id")
    .single();

  if (error || !service) destination(locale, "error=create_failed");
  const staffError = await replaceEligibleStaff(supabase, tenantId, service.id, selectedStaff(formData));
  if (staffError) {
    await supabase.from("services").delete().eq("id", service.id).eq("tenant_id", tenantId);
    destination(locale, "error=staff_assignment_failed");
  }

  revalidatePath(`/${locale}/dashboard/services`);
  destination(locale, "saved=created");
}

export async function updateService(locale: Locale, formData: FormData) {
  const serviceId = text(formData, "service_id");
  const { supabase, tenantId, currency } = await ownerContext(locale);
  const values = parseService(formData, currency);
  if (!uuid.safeParse(serviceId).success || !values) destination(locale, "error=invalid_service");
  const { error } = await supabase
    .from("services")
    .update({ ...values, currency, updated_at: new Date().toISOString() })
    .eq("id", serviceId)
    .eq("tenant_id", tenantId);
  if (error) destination(locale, "error=update_failed");

  const staffError = await replaceEligibleStaff(supabase, tenantId, serviceId, selectedStaff(formData));
  if (staffError) destination(locale, "error=staff_assignment_failed");

  revalidatePath(`/${locale}/dashboard/services`);
  destination(locale, "saved=updated");
}

export async function setServiceActive(locale: Locale, formData: FormData) {
  const serviceId = text(formData, "service_id");
  const active = text(formData, "active") === "true";
  if (!uuid.safeParse(serviceId).success) destination(locale, "error=invalid_service");

  const { supabase, tenantId } = await ownerContext(locale);
  const { error } = await supabase
    .from("services")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", serviceId)
    .eq("tenant_id", tenantId);
  if (error) destination(locale, "error=status_failed");

  revalidatePath(`/${locale}/dashboard/services`);
  destination(locale, active ? "saved=restored" : "saved=archived");
}

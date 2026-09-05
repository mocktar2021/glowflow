"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const maximumImageBytes = 1024 * 1024;
const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function list(formData: FormData, name: string) {
  return formData.getAll(name).map(String).map((item) => item.trim()).filter(Boolean);
}

function fail(locale: Locale, code: string): never {
  redirect(`/${locale}/dashboard/public-profile?error=${encodeURIComponent(code)}`);
}

function extension(file: File) {
  const byType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
  };
  return byType[file.type] ?? "bin";
}

async function uploadImage(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  tenantId: string,
  file: File,
) {
  if (!allowedImageTypes.has(file.type) || file.size > maximumImageBytes) {
    throw new Error("invalid_image");
  }

  const path = `${tenantId}/${crypto.randomUUID()}.${extension(file)}`;
  const { error } = await supabase.storage.from("salon-public-media").upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error("upload_failed");

  const { data } = supabase.storage.from("salon-public-media").getPublicUrl(path);
  return { path, url: data.publicUrl };
}

export async function savePublicSalonProfile(locale: Locale, formData: FormData) {
  const { supabase, userId } = await requireUser(locale);
  const { data: owner } = await supabase
    .from("users")
    .select("tenant_id, role")
    .eq("id", userId)
    .single();

  if (!owner?.tenant_id || owner.role !== "owner") fail(locale, "owner_required");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, slug, country_code, city, postal_code, address_line1, administrative_area")
    .eq("id", owner.tenant_id)
    .single();
  if (!tenant) fail(locale, "workspace_missing");

  const businessName = field(formData, "business_name");
  const city = field(formData, "city");
  const postalCode = field(formData, "postal_code");
  const addressLine1 = field(formData, "address_line1");
  const categories = list(formData, "categories").filter((item) => ["hair", "nails", "other"].includes(item));
  const paymentMethods = list(formData, "payment_methods").filter((item) => ["card", "cash", "deposit", "mixed"].includes(item));
  const descriptionJson = {
    fr: field(formData, "description_fr"),
    en: field(formData, "description_en"),
    es: field(formData, "description_es"),
  };
  const policiesJson = {
    fr: field(formData, "policies_fr"),
    en: field(formData, "policies_en"),
    es: field(formData, "policies_es"),
  };
  const openingHours = Object.fromEntries(days.map((day) => [day, field(formData, `hours_${day}`)]));
  const teamJson = [1, 2, 3]
    .map((index) => ({
      name: field(formData, `team_${index}_name`),
      role: field(formData, `team_${index}_role`),
    }))
    .filter((member) => member.name);
  const publish = formData.get("is_published") === "on";

  if (businessName.length < 2 || !city || !postalCode || !addressLine1) fail(locale, "required_fields");
  if (publish && (!categories.length || !paymentMethods.length || !Object.values(descriptionJson).every(Boolean))) {
    fail(locale, "publish_incomplete");
  }

  const { data: existing } = await supabase
    .from("salon_public_profiles")
    .select("image_url, gallery_urls")
    .eq("tenant_id", owner.tenant_id)
    .maybeSingle();

  let coverUrl = existing?.image_url ?? null;
  let galleryUrls = Array.isArray(existing?.gallery_urls) ? existing.gallery_urls : [];
  const uploadedPaths: string[] = [];

  try {
    const cover = formData.get("cover_photo");
    if (cover instanceof File && cover.size > 0) {
      const uploaded = await uploadImage(supabase, owner.tenant_id, cover);
      uploadedPaths.push(uploaded.path);
      coverUrl = uploaded.url;
    }

    const gallery = formData.getAll("gallery_photos").filter((item): item is File => item instanceof File && item.size > 0);
    if (galleryUrls.length + gallery.length > 8) throw new Error("gallery_limit");
    for (const photo of gallery) {
      const uploaded = await uploadImage(supabase, owner.tenant_id, photo);
      uploadedPaths.push(uploaded.path);
      galleryUrls = [...galleryUrls, uploaded.url];
    }
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from("salon-public-media").remove(uploadedPaths);
    fail(locale, error instanceof Error ? error.message : "upload_failed");
  }

  if (publish && !coverUrl) fail(locale, "cover_required");

  const { error } = await supabase.from("salon_public_profiles").upsert({
    tenant_id: owner.tenant_id,
    slug: tenant.slug,
    business_name: businessName,
    description_json: descriptionJson,
    country_code: tenant.country_code,
    city,
    postal_code: postalCode,
    address_line1: addressLine1,
    administrative_area: field(formData, "administrative_area"),
    public_phone: field(formData, "public_phone") || null,
    categories,
    product_keywords: list(formData, "product_keywords"),
    image_url: coverUrl,
    gallery_urls: galleryUrls,
    opening_hours: openingHours,
    team_json: teamJson,
    policies_json: policiesJson,
    payment_methods: paymentMethods,
    is_published: publish,
    published_at: publish ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id" });

  if (error) fail(locale, "save_failed");

  revalidatePath(`/${locale}/dashboard/public-profile`);
  revalidatePath(`/${locale}/salons/${tenant.slug}`);
  revalidatePath(`/${locale}/salons`);
  redirect(`/${locale}/dashboard/public-profile?saved=1`);
}

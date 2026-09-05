"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";

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

function storagePath(url: string) {
  const marker = "/storage/v1/object/public/salon-public-media/";
  const index = url.indexOf(marker);
  return index < 0 ? null : decodeURIComponent(url.slice(index + marker.length));
}


function ownedStoragePath(url: string, tenantId: string) {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const path = storagePath(url);
  if (!projectUrl || !path || !path.startsWith(`${tenantId}/`)) return null;
  try {
    return new URL(url).origin === new URL(projectUrl).origin ? path : null;
  } catch {
    return null;
  }
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

  const previousCoverUrl = existing?.image_url ?? null;
  const previousGalleryUrls = Array.isArray(existing?.gallery_urls) ? existing.gallery_urls : [];
  const removedGalleryUrls = new Set(list(formData, "remove_gallery_urls"));
  const uploadedCoverUrl = field(formData, "uploaded_cover_url") || null;
  const uploadedGalleryUrls = list(formData, "uploaded_gallery_urls");
  const uploadedUrls = [...(uploadedCoverUrl ? [uploadedCoverUrl] : []), ...uploadedGalleryUrls];
  const uploadedPaths = uploadedUrls.map((url) => ownedStoragePath(url, owner.tenant_id));

  if (uploadedPaths.some((path) => !path)) fail(locale, "invalid_image_url");

  const coverUrl = formData.get("remove_cover") === "on" ? null : uploadedCoverUrl ?? previousCoverUrl;
  let galleryUrls = previousGalleryUrls.filter((url: string) => !removedGalleryUrls.has(url));
  galleryUrls = [...galleryUrls, ...uploadedGalleryUrls];

  if (galleryUrls.length > 8) {
    if (uploadedPaths.length) await supabase.storage.from("salon-public-media").remove(uploadedPaths.filter((path): path is string => Boolean(path)));
    fail(locale, "gallery_limit");
  }

  if (publish && !coverUrl) {
    if (uploadedPaths.length) await supabase.storage.from("salon-public-media").remove(uploadedPaths.filter((path): path is string => Boolean(path)));
    fail(locale, "cover_required");
  }

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
    product_keywords: field(formData, "product_keywords").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30),
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

  if (error) {
    if (uploadedPaths.length) await supabase.storage.from("salon-public-media").remove(uploadedPaths.filter((path): path is string => Boolean(path)));
    fail(locale, "save_failed");
  }

  const obsoleteUrls = [
    ...previousGalleryUrls.filter((url: string) => !galleryUrls.includes(url)),
    ...(previousCoverUrl && previousCoverUrl !== coverUrl ? [previousCoverUrl] : []),
  ];
  const obsoletePaths = obsoleteUrls.map(storagePath).filter((path): path is string => Boolean(path));
  if (obsoletePaths.length) await supabase.storage.from("salon-public-media").remove(obsoletePaths);

  revalidatePath(`/${locale}/dashboard/public-profile`);
  revalidatePath(`/${locale}/salons/${tenant.slug}`);
  revalidatePath(`/${locale}/salons`);
  redirect(`/${locale}/dashboard/public-profile?saved=1`);
}

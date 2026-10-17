"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";

const productIdSchema = z.string().uuid();
const optionalName = z.string().trim().max(120).refine((value) => value.length === 0 || value.length >= 2);
const productSchema = z.object({
  nameFr: optionalName,
  nameEn: optionalName,
  nameEs: optionalName,
  descriptionFr: z.string().trim().max(1200),
  descriptionEn: z.string().trim().max(1200),
  descriptionEs: z.string().trim().max(1200),
  altFr: z.string().trim().max(180),
  altEn: z.string().trim().max(180),
  altEs: z.string().trim().max(180),
  category: z.enum(["hair", "nails", "skincare", "accessories", "other"]),
  currency: z.enum(["EUR", "USD"]),
  stockVisibility: z.enum(["available", "unavailable", "not_shown"]),
  publicationAction: z.enum(["private", "publish"]),
});

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function moneyToMinor(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount <= 2147483647 ? amount : null;
}

function ownedImagePath(url: string, tenantId: string, productId: string) {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl) return null;
  try {
    const parsed = new URL(url);
    const expected = new URL(projectUrl);
    const prefix = `/storage/v1/object/public/salon-public-media/${tenantId}/products/${productId}/`;
    if (parsed.origin !== expected.origin || !parsed.pathname.startsWith(prefix) || parsed.search || parsed.hash) return null;
    const filename = parsed.pathname.slice(prefix.length);
    return /^[0-9a-f-]{36}\.(?:jpg|png|webp|avif)$/.test(filename) ? `${tenantId}/products/${productId}/${filename}` : null;
  } catch {
    return null;
  }
}

async function ownerContext(locale: Locale) {
  const { supabase, userId } = await requireUser(locale);
  const { data: owner } = await supabase.from("users").select("tenant_id, role").eq("id", userId).single();
  if (!owner?.tenant_id || owner.role !== "owner") return null;
  const { data: tenant } = await supabase.from("tenants").select("slug").eq("id", owner.tenant_id).single();
  if (!tenant) return null;
  return { supabase, tenantId: owner.tenant_id, slug: tenant.slug };
}

function revalidateProducts(locale: Locale, slug: string) {
  revalidatePath(`/${locale}/dashboard/products`);
  for (const language of ["fr", "en", "es"]) revalidatePath(`/${language}/salons/${slug}`);
}

export async function saveProduct(locale: Locale, formData: FormData): Promise<{ saved: boolean; error?: string }> {
  const context = await ownerContext(locale);
  if (!context) return { saved: false, error: "owner_required" };
  const { supabase, tenantId, slug } = context;
  const productId = field(formData, "product_id");
  if (!productIdSchema.safeParse(productId).success) return { saved: false, error: "invalid_product" };

  const parsed = productSchema.safeParse({
    nameFr: field(formData, "name_fr"), nameEn: field(formData, "name_en"), nameEs: field(formData, "name_es"),
    descriptionFr: field(formData, "description_fr"), descriptionEn: field(formData, "description_en"), descriptionEs: field(formData, "description_es"),
    altFr: field(formData, "alt_fr"), altEn: field(formData, "alt_en"), altEs: field(formData, "alt_es"),
    category: field(formData, "category"), currency: field(formData, "currency"),
    stockVisibility: field(formData, "stock_visibility"), publicationAction: field(formData, "publication_action"),
  });
  const price = moneyToMinor(field(formData, "price"));
  if (!parsed.success || price === null) return { saved: false, error: "invalid_product" };
  const value = parsed.data;
  if (![value.nameFr, value.nameEn, value.nameEs].some(Boolean)) return { saved: false, error: "name_required" };

  const { data: existing, error: readError } = await supabase.from("salon_products")
    .select("id, image_url").eq("tenant_id", tenantId).eq("id", productId).maybeSingle();
  if (readError) return { saved: false, error: "read_failed" };
  const uploadedUrl = field(formData, "uploaded_image_url");
  if (uploadedUrl && !ownedImagePath(uploadedUrl, tenantId, productId)) return { saved: false, error: "invalid_image" };
  const removeImage = field(formData, "remove_image") === "on";
  const imageUrl = uploadedUrl || (removeImage ? null : existing?.image_url ?? null);
  if (imageUrl && ![value.altFr, value.altEn, value.altEs].some(Boolean)) return { saved: false, error: "image_alt_required" };

  const values = {
    name_json: { fr: value.nameFr, en: value.nameEn, es: value.nameEs },
    description_json: { fr: value.descriptionFr, en: value.descriptionEn, es: value.descriptionEs },
    image_alt_json: { fr: value.altFr, en: value.altEn, es: value.altEs },
    category: value.category,
    image_url: imageUrl,
    price,
    currency: value.currency,
    stock_visibility: value.stockVisibility,
    is_published: value.publicationAction === "publish",
    updated_at: new Date().toISOString(),
  };

  const result = existing
    ? await supabase.from("salon_products").update(values).eq("id", productId).eq("tenant_id", tenantId).select("id").single()
    : await supabase.from("salon_products").insert({ ...values, id: productId, tenant_id: tenantId }).select("id").single();
  if (result.error || !result.data) return { saved: false, error: "save_failed" };

  if (existing?.image_url && existing.image_url !== imageUrl) {
    const oldPath = ownedImagePath(existing.image_url, tenantId, productId);
    if (oldPath) await supabase.storage.from("salon-public-media").remove([oldPath]);
  }
  revalidateProducts(locale, slug);
  return { saved: true };
}

export async function deleteProduct(locale: Locale, formData: FormData) {
  const context = await ownerContext(locale);
  if (!context) redirect(`/${locale}/dashboard/products?error=owner_required`);
  const { supabase, tenantId, slug } = context;
  const productId = field(formData, "product_id");
  if (!productIdSchema.safeParse(productId).success) redirect(`/${locale}/dashboard/products?error=invalid_product`);
  const { data: product, error } = await supabase.from("salon_products")
    .delete().eq("tenant_id", tenantId).eq("id", productId).select("image_url").single();
  if (error || !product) redirect(`/${locale}/dashboard/products?error=delete_failed`);
  const imagePath = product.image_url ? ownedImagePath(product.image_url, tenantId, productId) : null;
  if (imagePath) await supabase.storage.from("salon-public-media").remove([imagePath]);
  revalidateProducts(locale, slug);
  redirect(`/${locale}/dashboard/products?deleted=1`);
}

import type { Locale } from "@/lib/i18n";

export type SalonSearchResult = {
  slug: string;
  business_name: string;
  description_json: Partial<Record<Locale, string>>;
  country_code: string;
  city: string;
  postal_code: string;
  categories: string[];
  product_keywords: string[];
  image_url: string | null;
  next_available_at: string | null;
  starting_price: number | null;
  currency: string;
  total_count: number;
};

export const categoryValues = ["hair", "nails", "other"] as const;
export type SalonCategory = (typeof categoryValues)[number];
export const salonSortValues = ["relevance", "price_asc", "price_desc", "availability"] as const;
export type SalonSort = (typeof salonSortValues)[number];

export function salonSearchSort(value: string): SalonSort {
  return salonSortValues.includes(value as SalonSort) ? value as SalonSort : "relevance";
}

export function isSalonCategory(value: string): value is SalonCategory {
  return categoryValues.includes(value as SalonCategory);
}

export function localizedDescription(result: SalonSearchResult, locale: Locale) {
  return result.description_json?.[locale]
    ?? result.description_json?.fr
    ?? result.description_json?.en
    ?? result.description_json?.es
    ?? "";
}

export function salonInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function publicSalonImageUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.endsWith(".supabase.co")
      && url.pathname.startsWith("/storage/v1/object/public/salon-public-media/")
      ? value : null;
  } catch {
    return null;
  }
}

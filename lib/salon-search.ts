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
  distance_meters?: number | null;
};

export const categoryValues = ["hair", "nails", "other"] as const;
export type SalonCategory = (typeof categoryValues)[number];
export const salonSortValues = ["relevance", "price_asc", "price_desc", "availability"] as const;
export type SalonSort = (typeof salonSortValues)[number];

export function salonSearchSort(value: string): SalonSort {
  return salonSortValues.includes(value as SalonSort) ? value as SalonSort : "relevance";
}

// Catalog prices are stored in cents in the currently supported EUR and USD markets.
export function maximumPriceMinorUnits(value: string, currency: string | null): number | null {
  if (!value || !currency || !["EUR", "USD"].includes(currency) || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Math.round(Number(value) * 100);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 2_147_483_647 ? amount : null;
}

export function coarseVisitorOrigin(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { origin_lat: Math.round(latitude * 100) / 100, origin_lon: Math.round(longitude * 100) / 100 };
}

export function salonSearchPage(value: string) {
  if (!/^\d+$/.test(value)) return 1;
  const page = Number(value);
  // Keep offsets bounded even for hostile URLs.
  return Number.isSafeInteger(page) && page >= 1 && page <= 1000 ? page : 1;
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

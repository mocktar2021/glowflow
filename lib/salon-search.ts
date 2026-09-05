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

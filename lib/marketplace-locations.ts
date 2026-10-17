import type { Locale } from "@/lib/i18n";
import { fallbackMarkets, type Market } from "@/lib/markets";

export type MarketplaceLocation = { market: Market; city?: string };

export function marketplaceLocation(country: string, citySegments?: string[]): MarketplaceLocation | null {
  const market = fallbackMarkets.find((item) => item.country_code === country);
  if (!market || (citySegments && citySegments.length > 1)) return null;
  if (!citySegments?.length) return { market };

  const city = citySegments[0]?.normalize("NFC").trim();
  if (!city || city.length > 120 || !/^[\p{L}\p{N}][\p{L}\p{M}\p{N}\p{Zs}.'’()-]*$/u.test(city)) return null;
  return { market, city };
}

export function marketplaceLocationHref(locale: Locale, country: string, city?: string) {
  const base = `/${locale}/salons/locations/${country}`;
  return city ? `${base}/${encodeURIComponent(city)}` : base;
}

import type { Locale } from "@/lib/i18n";

export type Market = {
  country_code: string;
  name_json: Record<Locale, string>;
  supported_locales: Locale[];
  default_locale: Locale;
  currency: string;
  default_time_zone: string;
  supported_time_zones: string[];
  address_format: {
    fields?: string[];
    postal_code_label?: string;
    postal_code_pattern?: string;
  };
  tax_config: Record<string, unknown>;
  payment_methods: string[];
  status: "active" | "inactive";
};

export const fallbackMarkets: Market[] = [
  {
    country_code: "FR",
    name_json: { fr: "France", en: "France", es: "Francia" },
    supported_locales: ["fr", "en", "es"],
    default_locale: "fr",
    currency: "EUR",
    default_time_zone: "Europe/Paris",
    supported_time_zones: ["Europe/Paris"],
    address_format: { postal_code_label: "Code postal", postal_code_pattern: "^[0-9]{5}$" },
    tax_config: { mode: "vat", label: "TVA" },
    payment_methods: ["card", "cash"],
    status: "active",
  },
  {
    country_code: "US",
    name_json: { fr: "États-Unis", en: "United States", es: "Estados Unidos" },
    supported_locales: ["fr", "en", "es"],
    default_locale: "en",
    currency: "USD",
    default_time_zone: "America/New_York",
    supported_time_zones: [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
    ],
    address_format: { postal_code_label: "ZIP code", postal_code_pattern: "^[0-9]{5}(-[0-9]{4})?$" },
    tax_config: { mode: "sales_tax", label: "Sales tax" },
    payment_methods: ["card", "cash"],
    status: "active",
  },
  {
    country_code: "ES",
    name_json: { fr: "Espagne", en: "Spain", es: "España" },
    supported_locales: ["fr", "en", "es"],
    default_locale: "es",
    currency: "EUR",
    default_time_zone: "Europe/Madrid",
    supported_time_zones: ["Europe/Madrid", "Atlantic/Canary"],
    address_format: { postal_code_label: "Código postal", postal_code_pattern: "^[0-9]{5}$" },
    tax_config: { mode: "vat", label: "IVA" },
    payment_methods: ["card", "cash"],
    status: "active",
  },
];

export function marketName(market: Market, locale: Locale) {
  return market.name_json[locale] ?? market.name_json[market.default_locale] ?? market.country_code;
}

export function formatMoney(amount: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatLocalDateTime(value: Date | string, locale: Locale, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

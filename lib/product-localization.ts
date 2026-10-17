import type { Locale } from "./i18n";

export function productDefaultLocale(value: string | null | undefined): Locale {
  return value === "fr" || value === "en" || value === "es" ? value : "fr";
}

export function localizedProductText(
  values: Record<string, string> | null | undefined,
  selectedLocale: Locale,
  defaultLocale: Locale,
) {
  for (const language of [selectedLocale, defaultLocale, "fr", "en", "es"]) {
    const text = values?.[language]?.trim();
    if (text) return text;
  }
  return "";
}

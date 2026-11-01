import type { Locale } from "@/lib/i18n";

export function selectPublishedPolicy(value: unknown, locale: Locale) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const policies = value as Record<string, unknown>;
  for (const language of [locale, "fr", "en", "es"] as const) {
    const text = policies[language];
    if (typeof text === "string" && text.trim()) return { text: text.trim(), language };
  }
  return null;
}

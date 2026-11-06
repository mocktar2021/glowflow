"use client";

import { Check, ChevronDown, Languages } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Locale } from "@/lib/i18n";

const languageOptions: Array<{ locale: Locale; short: string; name: string }> = [
  { locale: "fr", short: "FR", name: "Français" },
  { locale: "en", short: "EN", name: "English" },
  { locale: "es", short: "ES", name: "Español" },
];

const accessibleLabel: Record<Locale, string> = {
  fr: "Changer de langue",
  en: "Change language",
  es: "Cambiar idioma",
};

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const current = languageOptions.find((option) => option.locale === locale)!;

  function switchLocale(nextLocale: string) {
    if (nextLocale === locale) return;

    const segments = pathname.split("/");
    segments[1] = nextLocale;
    document.cookie = `glowflow_locale=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    window.localStorage.setItem("glowflow_locale", nextLocale);
    void fetch("/api/preferences/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: nextLocale }),
    });

    // Preserve sandbox mode and other current route state across locales.
    const destination = segments.join("/") + window.location.search + window.location.hash;
    startTransition(() => router.push(destination));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-10 rounded-full border-input bg-card/90 px-3 text-foreground shadow-none backdrop-blur hover:bg-accent"
          disabled={isPending}
        >
          <span className="sr-only">{accessibleLabel[locale]} </span>
          <Languages className="size-4 sm:hidden" aria-hidden="true" />
          <span>{current.short}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 rounded-2xl p-1.5">
        <DropdownMenuRadioGroup value={locale} onValueChange={switchLocale}>
          {languageOptions.map((option) => (
            <DropdownMenuRadioItem
              key={option.locale}
              value={option.locale}
              className="rounded-xl py-2.5"
            >
              <span>{option.name}</span>
              {locale === option.locale ? <Check className="ml-auto size-4" /> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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

const languageOptions: Array<{ locale: Locale; short: string; flag: string }> = [
  { locale: "fr", short: "FR", flag: "🇫🇷" },
  { locale: "en", short: "EN", flag: "🇬🇧" },
  { locale: "es", short: "ES", flag: "🇪🇸" },
];

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

    startTransition(() => router.push(segments.join("/")));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-10 rounded-full border-[#decaa6] bg-white/75 px-3 text-slate-800 shadow-none backdrop-blur hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-stone-100 dark:hover:bg-white/10"
          disabled={isPending}
          aria-label="Change language"
        >
          <Languages className="size-4 sm:hidden" />
          <span className="hidden sm:inline">{current.flag}</span>
          <span>{current.short}</span>
          <ChevronDown className="size-3.5 opacity-60" />
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
              <span>{option.flag}</span>
              <span>{option.short}</span>
              {locale === option.locale ? <Check className="ml-auto size-4" /> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

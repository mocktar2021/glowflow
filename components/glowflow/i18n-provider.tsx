"use client";

import { NextIntlClientProvider } from "next-intl";

import type { Locale } from "@/lib/i18n";

type ProviderMessages = React.ComponentProps<typeof NextIntlClientProvider>["messages"];

export function GlowFlowIntlProvider({
  children,
  locale,
  messages,
}: {
  children: React.ReactNode;
  locale: Locale;
  messages: ProviderMessages;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone="Europe/Paris"
    >
      {children}
    </NextIntlClientProvider>
  );
}

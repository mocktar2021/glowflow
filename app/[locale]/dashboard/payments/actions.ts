"use server";

import { redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { sandboxOnboardingUrl } from "@/lib/stripe-sandbox";

export async function startSandboxOnboarding(locale: string) {
  if (!isLocale(locale)) redirect("/fr/dashboard");
  let url: string;
  try {
    url = await sandboxOnboardingUrl(locale);
  } catch (error) {
    const known = ["owner_required", "market_unavailable", "reconciliation_required"];
    const code = error instanceof Error && known.includes(error.message) ? error.message : "sandbox_unavailable";
    redirect(`/${locale}/dashboard/payments?error=${code}`);
  }
  redirect(url);
}

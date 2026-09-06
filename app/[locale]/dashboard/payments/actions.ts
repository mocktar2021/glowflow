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
    // Log only diagnostic fields. Stripe messages and raw errors may contain private data.
    const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
    const safeToken = (value: unknown, pattern: RegExp) =>
      typeof value === "string" && pattern.test(value) ? value : undefined;
    console.error(JSON.stringify({
      event: "stripe_sandbox_onboarding_failed",
      reason: code,
      type: safeToken(details.type, /^Stripe[A-Za-z]+Error$/),
      stripeCode: safeToken(details.code, /^[a-z_]{1,80}$/),
      requestId: safeToken(details.requestId, /^req_[A-Za-z0-9]{1,100}$/),
      statusCode: typeof details.statusCode === "number" &&
        Number.isInteger(details.statusCode) && details.statusCode >= 400 &&
        details.statusCode <= 599 ? details.statusCode : undefined,
    }));
    redirect(`/${locale}/dashboard/payments?error=${code}`);
  }
  redirect(url);
}

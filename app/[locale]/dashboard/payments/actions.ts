"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
import { parseMinorAmount } from "@/lib/payments/recording";
import { sandboxOnboardingUrl } from "@/lib/stripe-sandbox";
import { sandboxOwner } from "@/lib/stripe-sandbox";

function paymentDestination(locale: Locale, result: string): never {
  redirect(`/${locale}/dashboard/payments?${result}`);
}

export async function recordManualPayment(locale: string, formData: FormData) {
  if (!isLocale(locale)) redirect("/fr/dashboard");
  const appointmentId = z.string().uuid().safeParse(String(formData.get("appointment_id") ?? ""));
  const paymentMethod = z.enum(["cash", "external_card"]).safeParse(formData.get("payment_method"));
  const requestKey = z.string().uuid().safeParse(String(formData.get("request_key") ?? ""));
  const amount = parseMinorAmount(String(formData.get("amount") ?? ""));
  if (!appointmentId.success || !paymentMethod.success || !requestKey.success || amount === null) {
    paymentDestination(locale, "record_error=invalid_payment");
  }

  const owner = await sandboxOwner();
  if (!owner) paymentDestination(locale, "record_error=owner_required");

  const { error } = await owner.supabase.rpc("record_manual_appointment_payment", {
    target_appointment_id: appointmentId.data,
    target_payment_method: paymentMethod.data,
    target_amount: amount,
    request_key: requestKey.data,
  });

  if (error) {
    const known = [
      "payment_exceeds_outstanding_balance",
      "payment_idempotency_key_reuse",
      "payment_appointment_not_found",
    ];
    const reason = known.find((code) => error.message.includes(code)) ?? "record_failed";
    paymentDestination(locale, `record_error=${reason}`);
  }

  revalidatePath(`/${locale}/dashboard/payments`);
  paymentDestination(locale, "recorded=1");
}

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

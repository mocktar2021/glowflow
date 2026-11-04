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

const onboardingFailureReasons = ["owner_required", "market_unavailable", "reconciliation_required"] as const;
type OnboardingFailureReason = typeof onboardingFailureReasons[number] | "sandbox_unavailable";

function onboardingFailureReason(error: unknown): OnboardingFailureReason {
  try {
    const message = error instanceof Error ? error.message : undefined;
    if (onboardingFailureReasons.some((reason) => reason === message)) {
      return message as OnboardingFailureReason;
    }
  } catch {
    // Provider error objects may have throwing getters or proxy traps.
  }
  return "sandbox_unavailable";
}

function onboardingFailureStatusCode(error: unknown): number | undefined {
  try {
    const statusCode = error && typeof error === "object"
      ? (error as Record<string, unknown>).statusCode : undefined;
    return typeof statusCode === "number" && Number.isInteger(statusCode) &&
      statusCode >= 400 && statusCode <= 599 ? statusCode : undefined;
  } catch {
    return undefined;
  }
}

function reportOnboardingFailure(error: unknown, reason: OnboardingFailureReason): void {
  try {
    // Only fixed context and a primitive HTTP status may reach logs. In
    // particular, never serialize the provider object or its error message.
    console.error(JSON.stringify({
      event: "stripe_sandbox_onboarding_failed",
      reason,
      statusCode: onboardingFailureStatusCode(error),
    }));
  } catch {
    // A hostile error getter or unavailable logger must not block the safe redirect.
  }
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
    const code = onboardingFailureReason(error);
    reportOnboardingFailure(error, code);
    redirect(`/${locale}/dashboard/payments?error=${code}`);
  }
  redirect(url);
}

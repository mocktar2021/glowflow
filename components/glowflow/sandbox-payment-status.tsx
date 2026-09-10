"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { isSandboxPaymentStatus, sandboxPaymentCopy, type SandboxPaymentStatus } from "@/lib/sandbox-payment-copy";

export function SandboxPaymentStatusPanel({ locale, salonSlug, reservationId }: { locale: Locale; salonSlug: string; reservationId: string }) {
  const labels = sandboxPaymentCopy[locale];
  const [status, setStatus] = useState<SandboxPaymentStatus>("pending");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/checkout?reservationId=${encodeURIComponent(reservationId)}`, { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok || !isSandboxPaymentStatus(result.status)) throw new Error("unavailable");
      setStatus(result.status);
      const destination = typeof result.url === "string" ? new URL(result.url) : null;
      setCheckoutUrl(destination?.protocol === "https:" && destination.hostname === "checkout.stripe.com" ? destination.href : null);
      setError(false);
    } catch {
      if (!signal?.aborted) setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [reservationId]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  return <main className="grid min-h-screen place-items-center bg-[#f3ece2] p-6 text-slate-950">
    <section className="w-full max-w-xl space-y-5 rounded-3xl bg-[#faf9f6] p-8 shadow-lg">
      <h1 className="text-2xl font-semibold">{labels.title}</h1>
      <p>{labels.notice}</p>
      <p role={error ? "alert" : "status"} aria-live="polite" className="rounded-xl bg-[#eadbc9] p-4">{error ? labels.unavailable : labels[status]}</p>
      <button type="button" disabled={loading} onClick={() => { setLoading(true); void refresh(); }} className="rounded-full bg-slate-950 px-6 py-3 text-white disabled:opacity-50">{labels.refresh}</button>
      {!error && status === "pending" && checkoutUrl ? <a href={checkoutUrl} className="block underline">{labels.pay}</a> : null}
      <div className="flex flex-wrap gap-5">
        <Link className="underline" href={`/${locale}/book/${salonSlug}?sandbox=1`}>{labels.another}</Link>
        <Link className="underline" href={`/${locale}/dashboard/payments`}>{labels.manage}</Link>
      </div>
    </section>
  </main>;
}

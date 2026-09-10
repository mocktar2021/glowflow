"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { isSandboxPaymentStatus, sandboxPaymentCopy, type SandboxPaymentStatus } from "@/lib/sandbox-payment-copy";

async function readReservation(reservationId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/checkout?reservationId=${encodeURIComponent(reservationId)}`, { cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok || !isSandboxPaymentStatus(result.status)) throw new Error("unavailable");
  const destination = typeof result.url === "string" ? new URL(result.url) : null;
  return {
    status: result.status,
    url: destination?.protocol === "https:" && destination.hostname === "checkout.stripe.com" ? destination.href : null,
  };
}

export function SandboxPaymentStatusPanel({ locale, salonSlug, reservationId }: { locale: Locale; salonSlug: string; reservationId: string }) {
  const labels = sandboxPaymentCopy[locale];
  const [status, setStatus] = useState<SandboxPaymentStatus>("pending");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const receive = useCallback((result: Awaited<ReturnType<typeof readReservation>>) => {
    setStatus(result.status);
    setCheckoutUrl(result.url);
    setError(false);
  }, []);
  async function refresh() {
    setLoading(true);
    try { receive(await readReservation(reservationId)); }
    catch { setError(true); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    readReservation(reservationId, controller.signal)
      .then(result => { if (!controller.signal.aborted) receive(result); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reservationId, receive]);
  return <main className="grid min-h-screen place-items-center bg-[#f3ece2] p-6 text-slate-950">
    <section className="w-full max-w-xl space-y-5 rounded-3xl bg-[#faf9f6] p-8 shadow-lg">
      <h1 className="text-2xl font-semibold">{labels.title}</h1>
      <p>{labels.notice}</p>
      <p role={error ? "alert" : "status"} aria-live="polite" className="rounded-xl bg-[#eadbc9] p-4">{error ? labels.unavailable : labels[status]}</p>
      <button type="button" disabled={loading} onClick={() => void refresh()} className="rounded-full bg-slate-950 px-6 py-3 text-white disabled:opacity-50">{labels.refresh}</button>
      {!error && status === "pending" && checkoutUrl ? <a href={checkoutUrl} className="block underline">{labels.pay}</a> : null}
      <div className="flex flex-wrap gap-5">
        <Link className="underline" href={`/${locale}/book/${salonSlug}?sandbox=1`}>{labels.another}</Link>
        <Link className="underline" href={`/${locale}/dashboard/payments`}>{labels.manage}</Link>
      </div>
    </section>
  </main>;
}

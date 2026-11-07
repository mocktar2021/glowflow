"use client";

import { useEffect, useRef, useState } from "react";

import { buttonClass, inputClass } from "@/components/glowflow/auth-shell";
import { CountryFields } from "@/components/glowflow/country-fields";
import type { Locale } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { authCopy } from "@/lib/auth-copy";

export function RegistrationForm({ locale, markets, action }: {
  locale: Locale;
  markets: Market[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const firstStep = useRef<HTMLDivElement>(null);
  const firstHeading = useRef<HTMLHeadingElement>(null);
  const secondHeading = useRef<HTMLHeadingElement>(null);
  const hasNavigated = useRef(false);
  const labels = authCopy[locale].register;

  useEffect(() => {
    if (!hasNavigated.current) return;
    (step === 1 ? firstHeading : secondHeading).current?.focus();
  }, [step]);

  function continueToSalon() {
    const fields = firstStep.current?.querySelectorAll<HTMLInputElement>("input");
    if (!fields) return;
    for (const field of fields) {
      if (!field.reportValidity()) return;
    }
    hasNavigated.current = true;
    setStep(2);
  }

  return (
    <form action={action} className="space-y-5">
      <ol className="flex gap-3 text-sm font-semibold" aria-label={labels.progress}>
        <li aria-current={step === 1 ? "step" : undefined} className={step === 1 ? "text-primary" : "text-muted-foreground"}>1. {labels.accountStep}</li>
        <li aria-current={step === 2 ? "step" : undefined} className={step === 2 ? "text-primary" : "text-muted-foreground"}>2. {labels.salonStep}</li>
      </ol>

      <div ref={firstStep} hidden={step !== 1} onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          continueToSalon();
        }
      }}>
        <h2 ref={firstHeading} tabIndex={-1} className="font-display text-2xl font-medium">{labels.accountStep}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{labels.accountBenefit}</p>
        <div className="mt-5 space-y-5">
          <label className="block text-sm font-medium">{labels.name}<input className={`${inputClass} mt-2`} name="full_name" autoComplete="name" minLength={2} required /></label>
          <label className="block text-sm font-medium">{labels.email}<input className={`${inputClass} mt-2`} name="email" type="email" autoComplete="email" required /></label>
          <label className="block text-sm font-medium">{labels.password}<input className={`${inputClass} mt-2`} name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        </div>
        <button className={`${buttonClass} mt-6`} type="button" onClick={continueToSalon}>{labels.continue}</button>
      </div>

      <div hidden={step !== 2}>
        <h2 ref={secondHeading} tabIndex={-1} className="font-display text-2xl font-medium">{labels.salonStep}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{labels.salonBenefit}</p>
        <div className="mt-5 space-y-5">
          <label className="block text-sm font-medium">{labels.salon}<input className={`${inputClass} mt-2`} name="salon_name" autoComplete="organization" minLength={2} required /></label>
          <CountryFields locale={locale} markets={markets} />
        </div>
        <div className="mt-6 rounded-2xl border border-border bg-muted/50 p-4 text-sm leading-6">
          <h3 className="font-semibold">{labels.pricingTitle}</h3>
          <p className="mt-1">{labels.pricingPreview}</p>
          <p className="mt-2 text-muted-foreground">{labels.pricingNotActive}</p>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          <button className={buttonClass} type="submit">{labels.submit}</button>
          <button className="min-h-12 rounded-full border border-border px-5 py-3 text-sm font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:min-w-32" type="button" onClick={() => { hasNavigated.current = true; setStep(1); }}>{labels.back}</button>
        </div>
      </div>
    </form>
  );
}

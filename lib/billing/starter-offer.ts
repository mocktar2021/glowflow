/**
 * Owner-approved Starter offer, not an active subscription catalog. No code
 * path currently calls this module to create Checkout or a Stripe Price.
 */
export type StarterOffer = Readonly<{
  countryCode: string;
  currency: "USD" | "EUR";
  monthlyPriceBeforeTaxMinorUnits: number;
  maxActivePeople: 3;
  trialCalendarMonths: 1;
  trialMissingDate: "last_day_of_next_month";
  paymentMethodRequiredBeforeTrial: true;
}>;

const offers: Readonly<Record<string, StarterOffer>> = Object.freeze({
  US: Object.freeze({
    countryCode: "US", currency: "USD", monthlyPriceBeforeTaxMinorUnits: 2999,
    maxActivePeople: 3, trialCalendarMonths: 1,
    trialMissingDate: "last_day_of_next_month", paymentMethodRequiredBeforeTrial: true,
  }),
  FR: Object.freeze({
    countryCode: "FR", currency: "EUR", monthlyPriceBeforeTaxMinorUnits: 2499,
    maxActivePeople: 3, trialCalendarMonths: 1,
    trialMissingDate: "last_day_of_next_month", paymentMethodRequiredBeforeTrial: true,
  }),
  ES: Object.freeze({
    countryCode: "ES", currency: "EUR", monthlyPriceBeforeTaxMinorUnits: 2499,
    maxActivePeople: 3, trialCalendarMonths: 1,
    trialMissingDate: "last_day_of_next_month", paymentMethodRequiredBeforeTrial: true,
  }),
  BE: Object.freeze({
    countryCode: "BE", currency: "EUR", monthlyPriceBeforeTaxMinorUnits: 2499,
    maxActivePeople: 3, trialCalendarMonths: 1,
    trialMissingDate: "last_day_of_next_month", paymentMethodRequiredBeforeTrial: true,
  }),
  LU: Object.freeze({
    countryCode: "LU", currency: "EUR", monthlyPriceBeforeTaxMinorUnits: 2499,
    maxActivePeople: 3, trialCalendarMonths: 1,
    trialMissingDate: "last_day_of_next_month", paymentMethodRequiredBeforeTrial: true,
  }),
});

/** An unsupported or untrusted market is never assigned a fallback price. */
export function approvedStarterOffer(countryCode: unknown): StarterOffer | null {
  if (typeof countryCode !== "string" || !/^[A-Z]{2}$/.test(countryCode)) return null;
  return Object.hasOwn(offers, countryCode) ? offers[countryCode] : null;
}

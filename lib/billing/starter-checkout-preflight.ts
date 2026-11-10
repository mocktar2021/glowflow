import { approvedStarterOffer } from "./starter-offer";

/**
 * Inert GLOW-53 checks for a future owner-only platform Checkout route. This
 * module never calls Stripe and does not decide whether tax collection is ready.
 */
export type StarterPriceEvidence = Readonly<{
  priceId: string;
  countryCode: string;
  currency: "USD" | "EUR";
  monthlyPriceBeforeTaxMinorUnits: number;
  livemode: boolean;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Compare an expanded Stripe Price with the owner-approved Starter offer.
 * The price ID and mode must come from trusted server configuration, not a
 * browser request. This is price evidence only, not permission to charge.
 */
export function reviewStarterPriceEvidence(
  countryCode: unknown,
  configuredPriceId: unknown,
  expectedLivemode: unknown,
  stripePrice: unknown,
): StarterPriceEvidence | null {
  const offer = approvedStarterOffer(countryCode);
  if (!offer || typeof configuredPriceId !== "string"
    || !/^price_[A-Za-z0-9]+$/.test(configuredPriceId)
    || typeof expectedLivemode !== "boolean"
    || !isRecord(stripePrice)
    || stripePrice.object !== "price"
    || stripePrice.id !== configuredPriceId
    || stripePrice.active !== true
    || stripePrice.livemode !== expectedLivemode
    || stripePrice.currency !== offer.currency.toLowerCase()
    || stripePrice.unit_amount !== offer.monthlyPriceBeforeTaxMinorUnits
    || stripePrice.billing_scheme !== "per_unit"
    || stripePrice.type !== "recurring"
    || stripePrice.tax_behavior !== "exclusive"
    || !isRecord(stripePrice.recurring)
    || stripePrice.recurring.interval !== "month"
    || stripePrice.recurring.interval_count !== 1
    || stripePrice.recurring.usage_type !== "licensed") return null;

  return Object.freeze({
    priceId: configuredPriceId,
    countryCode: offer.countryCode,
    currency: offer.currency,
    monthlyPriceBeforeTaxMinorUnits: offer.monthlyPriceBeforeTaxMinorUnits,
    livemode: expectedLivemode,
  });
}

/**
 * Calculate only the local calendar date. A future Checkout route must choose
 * and review its billing time zone before converting this into `trial_end`.
 */
export function nextCalendarMonthTrialEndDate(startDate: unknown): string | null {
  if (typeof startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const [year, month, day] = startDate.split("-").map(Number);
  if (year < 2000 || year > 9998 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const input = new Date(Date.UTC(year, month - 1, day));
  if (input.getUTCFullYear() !== year || input.getUTCMonth() !== month - 1
    || input.getUTCDate() !== day) return null;

  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const lastDay = new Date(Date.UTC(nextMonthYear, nextMonth, 0)).getUTCDate();
  return `${nextMonthYear.toString().padStart(4, "0")}-${nextMonth.toString().padStart(2, "0")}-${Math.min(day, lastDay).toString().padStart(2, "0")}`;
}

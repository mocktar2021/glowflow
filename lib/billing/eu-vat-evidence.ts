/**
 * A server-side guard for EU salon subscription preparation. Callers must load
 * the buyer's billing country and tax IDs from trusted server/Stripe records,
 * not infer billing country from the salon's operating country or browser
 * request. This guard cannot decide whether reverse charge legally applies or
 * replace a Stripe Tax calculation.
 */
const supportedEuMarkets = new Set(["FR", "ES", "BE", "LU"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Stripe verifies EU VAT IDs with VIES asynchronously. A correctly formatted
 * but pending, unverified, or unavailable ID must not authorize our stricter
 * reverse-charge checkout path. Stripe Tax can otherwise apply reverse charge
 * based on format alone.
 *
 * Returns only the Stripe tax-ID object ID so the VAT number is not copied into
 * application logs or a second store. Multiple IDs for the same market fail
 * closed rather than allowing Stripe to choose a different one at checkout.
 */
export function verifiedEuVatTaxIdForBillingCountry(
  billingCountryCode: unknown,
  stripeTaxIds: unknown,
): string | null {
  if (typeof billingCountryCode !== "string"
    || !supportedEuMarkets.has(billingCountryCode)
    || !Array.isArray(stripeTaxIds)) return null;

  const matching = stripeTaxIds.filter((candidate) => {
    if (!isRecord(candidate) || candidate.type !== "eu_vat"
      || typeof candidate.value !== "string") return false;
    const normalized = candidate.value.replace(/\s+/g, "").toUpperCase();
    return /^[A-Z]{2}[A-Z0-9]{2,20}$/.test(normalized)
      && normalized.slice(0, 2) === billingCountryCode;
  });
  if (matching.length !== 1) return null;

  const taxId = matching[0] as Record<string, unknown>;
  if (typeof taxId.id !== "string" || !/^txi_[A-Za-z0-9]+$/.test(taxId.id)
    || !isRecord(taxId.verification)
    || taxId.verification.status !== "verified") return null;
  return taxId.id;
}

/** A zero amount or `not_collecting` is never proof of reverse charge. */
export function hasVerifiedReverseChargeEvidence(
  billingCountryCode: unknown,
  stripeTaxIds: unknown,
  taxabilityReason: unknown,
): boolean {
  return taxabilityReason === "reverse_charge"
    && verifiedEuVatTaxIdForBillingCountry(billingCountryCode, stripeTaxIds) !== null;
}

import {
  reviewStarterPriceEvidence,
  type StarterPriceEvidence,
} from "./starter-checkout-preflight";

/**
 * Inert evidence for a future platform subscription Checkout route. A reviewed
 * Product and its tax code must be supplied by server configuration, not by
 * the browser. This does not establish a tax registration or allow a charge.
 */
export type StarterProductEvidence = Readonly<StarterPriceEvidence & {
  productId: string;
  productName: string;
  taxCodeId: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Require a single expanded Product bound to the exact reviewed Price. This
 * prevents a correctly priced but unrelated Product, inactive Product, or
 * unreviewed tax code from silently entering future Checkout configuration.
 */
export function reviewStarterProductEvidence(
  countryCode: unknown,
  configuredPriceId: unknown,
  configuredProductId: unknown,
  configuredProductName: unknown,
  approvedTaxCodeId: unknown,
  expectedLivemode: unknown,
  expandedPrice: unknown,
): StarterProductEvidence | null {
  const price = reviewStarterPriceEvidence(
    countryCode, configuredPriceId, expectedLivemode, expandedPrice,
  );
  if (!price || typeof configuredProductId !== "string"
    || !/^prod_[A-Za-z0-9]+$/.test(configuredProductId)
    || typeof configuredProductName !== "string"
    || configuredProductName.length === 0
    || configuredProductName.length > 120
    || configuredProductName.trim() !== configuredProductName
    || typeof approvedTaxCodeId !== "string"
    || !/^txcd_[0-9]+$/.test(approvedTaxCodeId)
    || !isRecord(expandedPrice)
    || !isRecord(expandedPrice.product)) return null;

  const product = expandedPrice.product;
  if (product.object !== "product"
    || product.id !== configuredProductId
    || product.active !== true
    || product.livemode !== expectedLivemode
    || product.name !== configuredProductName
    || product.tax_code !== approvedTaxCodeId) return null;

  return Object.freeze({
    ...price,
    productId: configuredProductId,
    productName: configuredProductName,
    taxCodeId: approvedTaxCodeId,
  });
}

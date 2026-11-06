/**
 * Pure GLOW-53 plan-selection contract. No catalog, price, or activation is
 * shipped with this module. A later reviewed server route may supply a trusted
 * catalog after the owner approves markets, tiers, and billing policy.
 */
export type SalonSubscriptionPlan = Readonly<{
  planKey: string;
  countryCode: string;
  currency: string;
  maxTeamMembers: number;
  includedSms: number;
  includedWhatsApp: number;
  stripePriceId: string;
}>;

export type SalonSubscriptionContext = Readonly<{
  countryCode: string;
  currency: string;
  activeTeamMembers: number;
}>;

const planKeys = [
  "planKey", "countryCode", "currency", "maxTeamMembers",
  "includedSms", "includedWhatsApp", "stripePriceId",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const found = Object.keys(value);
  return found.length === keys.length && found.every((key) => keys.includes(key));
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validPlan(value: unknown): value is SalonSubscriptionPlan {
  if (!isRecord(value) || !exactKeys(value, planKeys)) return false;
  return typeof value.planKey === "string" && /^[a-z][a-z0-9_-]{1,39}$/.test(value.planKey)
    && typeof value.countryCode === "string" && /^[A-Z]{2}$/.test(value.countryCode)
    && typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency)
    && nonNegativeInteger(value.maxTeamMembers) && value.maxTeamMembers > 0
    && nonNegativeInteger(value.includedSms)
    && nonNegativeInteger(value.includedWhatsApp)
    && typeof value.stripePriceId === "string"
    && /^price_[A-Za-z0-9]+$/.test(value.stripePriceId);
}

/** Reject an incomplete or ambiguous server catalog instead of guessing a plan. */
export function validateSalonSubscriptionCatalog(value: unknown): SalonSubscriptionPlan[] | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every(validPlan)) return null;
  const plans = value as SalonSubscriptionPlan[];
  const combinations = new Set<string>();
  const priceIds = new Set<string>();
  for (const plan of plans) {
    const combination = `${plan.countryCode}:${plan.currency}:${plan.planKey}`;
    if (combinations.has(combination) || priceIds.has(plan.stripePriceId)) return null;
    combinations.add(combination);
    priceIds.add(plan.stripePriceId);
  }
  return plans.map((plan) => Object.freeze({ ...plan }));
}

/**
 * Only a plan key may come from the browser. Tenant market and active team
 * count must be loaded by the server. No Price ID or amount may be requested.
 */
export function selectSalonSubscriptionPlan(
  catalog: unknown,
  request: unknown,
  context: unknown,
): SalonSubscriptionPlan | null {
  const plans = validateSalonSubscriptionCatalog(catalog);
  if (!plans || !isRecord(request) || !exactKeys(request, ["planKey"])
    || typeof request.planKey !== "string" || !isRecord(context)
    || !exactKeys(context, ["countryCode", "currency", "activeTeamMembers"])
    || typeof context.countryCode !== "string" || !/^[A-Z]{2}$/.test(context.countryCode)
    || typeof context.currency !== "string" || !/^[A-Z]{3}$/.test(context.currency)
    || !nonNegativeInteger(context.activeTeamMembers)) return null;

  const planKey = request.planKey;
  const countryCode = context.countryCode;
  const currency = context.currency;
  const activeTeamMembers = context.activeTeamMembers;
  return plans.find((plan) => plan.planKey === planKey
    && plan.countryCode === countryCode
    && plan.currency === currency
    && activeTeamMembers <= plan.maxTeamMembers) ?? null;
}

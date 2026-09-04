import Stripe from "stripe";

export function createStripeClient() {
  const apiKey = process.env.STRIPE_RESTRICTED_KEY;

  if (!apiKey) {
    throw new Error("Stripe server configuration is missing");
  }

  return new Stripe(apiKey, {
    apiVersion: "2026-07-29.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
  });
}

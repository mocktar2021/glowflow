# GLOW-53 platform subscription webhook, inactive contract

`lib/billing/platform-subscription-webhook.ts` is a pure ingress helper for a
future *platform* subscription webhook, separate from the salon connected
account deposit webhook. No route calls it and no billing endpoint, signing
secret, Stripe subscription, hosted database table, or delivery has been
activated by this slice.

The helper verifies the original raw request body with Stripe's signature
check and a dedicated platform billing signing secret before inspecting data.
It fails closed on missing configuration, invalid signatures, connected-account
events, wrong sandbox/live mode, and malformed signed subscription events. It
normalizes only `customer.subscription.created`, `.updated`, and `.deleted`
using Stripe Customer and Subscription IDs, not untrusted metadata. A future
handler must map those IDs to a trusted salon subscription record in the
database, then use an idempotent event ledger and monotonic state transition.
The Checkout success redirect is not proof of active access.

Every signed event outside the three reviewed subscription lifecycle types
returns a retry decision. This strict allowlist prevents an unfamiliar
invoice, Checkout, charge, refund, fraud, or future Stripe financial event
from being silently acknowledged. Even an accidentally subscribed benign
event retries until an explicit policy is reviewed. A future route should
return 503 and alert on this decision, not 200. Before paid launch, review the
Stripe API version and implement the full signed lifecycle, invoice, refund,
dispute, and fraud reconciliation paths and configure the dedicated endpoint
to subscribe only to intended types.

Tests sign fixtures with Stripe's actual webhook helper and cover tampering,
wrong secret, mode/account mismatch, malformed subscriptions, and unhandled
events across current and future Stripe families. They do not substitute for sandbox deliveries, Stripe
redelivery exercises, tenant isolation, historical ledger recovery, or live
operator acceptance. Keep GLOW-53 In Progress and billing off.

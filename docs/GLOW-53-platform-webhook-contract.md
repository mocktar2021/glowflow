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

Known financial events without a handler, including paid/failed invoices,
Checkout completion, disputes, refunds, and early fraud warnings, return a
retry decision so a future route cannot accidentally acknowledge them as
processed. The future route should return 503 and alert on this decision, not
200. The list is not a complete live event subscription: before paid launch,
review the Stripe API version and implement the full signed lifecycle, invoice,
refund, dispute, and fraud reconciliation paths. Only truly unrelated signed
event types can be acknowledged without processing.

Tests sign fixtures with Stripe's actual webhook helper and cover tampering,
wrong secret, mode/account mismatch, malformed subscriptions, and unhandled
financial events. They do not substitute for sandbox deliveries, Stripe
redelivery exercises, tenant isolation, historical ledger recovery, or live
operator acceptance. Keep GLOW-53 In Progress and billing off.

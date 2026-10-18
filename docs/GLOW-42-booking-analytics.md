# GLOW-42 booking response counts

When explicitly activated, the public booking API emits one server-side, count-only event for each **valid POST response** after attempting appointment creation:

| Outcome | Response | Meaning |
| --- | --- | --- |
| `confirmed` | 201 | The API returned an appointment confirmation. |
| `slot_unavailable` | 409 | The requested slot conflicted with authoritative availability. |
| `failed` | 500 | The API could not return a confirmation. |

The versioned event contains only `event`, `version`, `outcome`, and `count: 1`. It has no client, salon, tenant, country, locale, service, appointment, request, payment, provider, or correlation identifiers. Invalid requests and availability GETs are excluded. No cookie, browser tracking, external analytics service, database table, or payment capability is added. A logging failure cannot affect the booking result.

Logging is **disabled by default**. Only setting the server-side environment variable `GLOWFLOW_BOOKING_COUNT_LOGS_ENABLED=true` activates it. Merging or deploying this code does not change production telemetry without that separate configuration change. Before activation, the product owner should define the intended metric, privacy/log-retention review should account for host-generated timestamps and invocation metadata, and operations should decide how to guard against anonymous traffic inflating log volume. Do not enable the setting merely to satisfy this story.

These are **response counts, not unique bookings or a conversion rate**. The booking RPC is idempotent, so a retry may return another 201 for the same appointment and emit another `confirmed` count. A 500 after a database commit can likewise appear as `failed` even when the appointment exists. The event is a safe boundary for later operational aggregation, not a canonical financial or appointment fact. Defining a unique-booking or discovery-to-booking KPI requires an explicit product metric definition and a separate, deduplicated authoritative source. This slice does not instrument the owner-only Stripe sandbox checkout or webhooks.

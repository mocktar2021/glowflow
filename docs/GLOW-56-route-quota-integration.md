# GLOW-56 dormant route quota integration

This code-only draft stacks on the server-only quota key adapter (#198). It
also depends on the separate quota SQL draft (#197), which is not part of this
branch. That SQL now includes a separate unseeded capability-action quota RPC
and still needs exact-head review before merge or hosted application. No hosted SQL, policy
values, cleanup schedule, or secret is installed by this draft.

With the v2 flag on in a future isolated QA environment, new-cookie
`bootstrap`, `prepare`, and `reconcile` consume their respective durable quota
bucket before issuing a cookie or calling an intent RPC. Valid existing-cookie
bootstrap does not consume the shared-IP issuance bucket. The route validates the
existing signed browser cookie before consuming prepare/reconcile quota. It
passes only server-HMAC IP and browser digests to the service-role quota RPC,
not the raw IP, browser token, or client contact. A denied bucket returns 429
with integer `Retry-After` from 1 to 3600 seconds; missing keys, policy,
cleanup, RPC, or malformed responses return 503. Neither response falls back
to the legacy create endpoint or clears a pending browser intent marker.

`commit`, `cancel`, and `acknowledge` now call the separate dormant
`consume_public_booking_capability_quota` RPC after signed-cookie validation
and before their intent RPC. The server passes domain-separated HMAC digests
for the browser and exact browser+intent pair, without requiring an IP header
for recovery. Action quota denial never invokes an action RPC. Per-action
cooldowns do not suppress immediate reconciliation. A cancel-requested intent marker
persists the visitor's cancel choice across reloads and tabs, so a still-prepared
intent is not auto-committed during recovery. A successful acknowledgement
followed by failed reconciliation retries only reconciliation.

Approved policy ceilings, cleanup cadence and alert, real Vercel-header QA,
recovery UX checks, and the full v1-to-v2 cutover gate remain required before
activation. Keep
`GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED=false` and do not merge this branch as an
activation-ready change.

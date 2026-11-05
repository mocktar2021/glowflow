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
cooldowns do not suppress immediate reconciliation. A separate per-intent
cancel-requested marker cannot be overwritten by a pending-marker write.
Recovery never auto-commits a prepared intent, including when browser storage
rejects the cancel marker; only the original Confirm path sends its first
commit. A prepared result stays locked for cancellation or manual resolution.
A successful acknowledgement followed by failed reconciliation retries only
reconciliation.

Remaining activation blocker: a recovered prepared attempt no longer has an
automatic unchanged commit retry. Cross-tab click-time ordering between an
in-flight Confirm and Cancel cannot be guaranteed by browser storage; the
server serializes the requests it receives, and the UI must show the
authoritative result without claiming cancellation early. Review a safe
explicit completion path before enabling v2.

Approved policy ceilings, cleanup cadence and alert, real Vercel-header QA,
recovery UX checks, and the full v1-to-v2 cutover gate remain required before
activation. Keep
`GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED=false` and do not merge this branch as an
activation-ready change.

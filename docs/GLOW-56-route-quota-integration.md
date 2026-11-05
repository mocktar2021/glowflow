# GLOW-56 dormant route quota integration

This code-only draft stacks on the server-only quota key adapter (#198). It
also depends on the separate quota SQL draft (#197), which is not part of this
branch. That SQL needs its advisory-lock time-zone review resolved before it
can be considered for merge or hosted application. No hosted SQL, policy
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

`commit`, `cancel`, and `acknowledge` are still unbudgeted. A separately
reviewed capability-scoped abuse limit, approved policy ceilings, cleanup
cadence and alert, real Vercel-header QA, recovery UX checks, and the full
v1-to-v2 cutover gate are required before activation. Keep
`GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED=false` and do not merge this branch as an
activation-ready change.

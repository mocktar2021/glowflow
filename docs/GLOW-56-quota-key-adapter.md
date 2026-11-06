# GLOW-56 dormant quota key adapter

This code-only draft supplies HMAC-SHA-256 key digests for the separate dormant
quota database draft. It is not imported by either live booking route, has no
feature flag, and changes no hosted state. It never stores or returns raw IPs,
cookies, or contact information. The IP and browser namespaces are separated.

Vercel documents that it overwrites `x-forwarded-for` and does not forward a
caller-supplied value. The adapter accepts that header only in Vercel preview
or production, rejects comma-separated or malformed values, and rejects a
disagreeing `x-vercel-forwarded-for` copy. Missing or noncanonical 32-byte
base64url `GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY` fails closed. This must be a
distinct server-only secret from the booking-cookie signing key, scoped per
environment. Rotating it changes all quota buckets and needs an operator plan.

Before route integration, verify actual Vercel request headers in an isolated
QA deployment without logging raw addresses; integrate quota denial with the
pending-intent recovery UX; review policy ceilings, scheduler, alerts, and
capability-scoped limits on commit/cancel/acknowledge. Do not enable v2 or apply
quota SQL based on this draft alone.

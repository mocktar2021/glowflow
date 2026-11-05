# GLOW-55 canonical origin preflight

This code-only preparation does not switch the live domain. Until a separately
approved cutover, Production public metadata and JSON-LD keep
`https://glowflow.mocktar.com`. Preview continues to use its own Vercel URL.

At the beauty release window, the operator must verify the exact Vercel project,
READY deployment, DNS/TLS, Auth redirect allowlist, and isolated production
backend before setting `GLOWFLOW_CANONICAL_ORIGIN=https://glowflow.beauty` in
Production. Set and verify `GLOWFLOW_APP_URL` to that same origin for Auth and
invitation links in the same controlled release. Never copy production secrets
or customer data into Preview. An invalid configured canonical origin fails
closed instead of advertising an arbitrary domain.

Check FR/EN/ES landing, country, city, and salon canonical/Open Graph and
structured-data URLs on the exact deployment. Also check sign-in, password
reset, invitation callback, and booking links without creating live bookings or
payments during preflight. Record a rollback target and confirm both origin
settings and the domain alias can return to their previous values. This does
not activate invitations, payments, or any hosted database migration.

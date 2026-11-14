# GLOW-55 canonical origin preflight

This code-only preparation does not switch the live domain. Until a separately
approved cutover, Production public metadata and JSON-LD keep
`https://glowflow.mocktar.com`. Preview continues to use its own Vercel URL.
Production invitation delivery now refuses to compose links unless its explicit
`GLOWFLOW_APP_URL` matches that same approved public origin. This is a dormant
code guard, not permission to enable sending.
Production Auth signup and password-reset callbacks also refuse a beauty or
unknown App URL while the canonical origin remains on the current QA default.

At the beauty release window, the operator must verify the exact Vercel project,
READY deployment, DNS/TLS, Auth redirect allowlist, and isolated production
backend before setting `GLOWFLOW_CANONICAL_ORIGIN=https://glowflow.beauty` in
Production. Set and verify `GLOWFLOW_APP_URL` to that same origin for Auth and
invitation links in the same controlled release. The code now refuses to
advertise `glowflow.beauty` unless `NEXT_PUBLIC_SUPABASE_URL` is a distinct,
canonical Supabase project URL rather than the shared development project.
This check proves separation from the known QA project, not ownership of the
new project: verify its organization and identity before cutover. Never copy production secrets
or customer data into Preview. An invalid configured canonical origin fails
closed instead of advertising an arbitrary domain.

Check FR/EN/ES landing, country, city, and salon canonical/Open Graph and
structured-data URLs on the exact deployment. Also check sign-in, password
reset, invitation callback, and booking links without creating live bookings or
payments during preflight. Record a rollback target and confirm both origin
settings and the domain alias can return to their previous values. This does
not activate invitations, payments, or any hosted database migration.

The owner has chosen a public paid launch, not a no-payment pilot. The beauty
cutover therefore also requires proven separation of QA and production Stripe
credentials and webhook destinations, subscription billing and salon-deposit
approval, tax and refund policy, signed live-flow verification under an
authorized plan, and active failure alerts. See GLOW-23, GLOW-24, GLOW-34,
GLOW-35, GLOW-36, and GLOW-53. A READY page or correct SEO origin does not
waive those paid-launch gates or authorize a real charge.

The prior dashboard demonstration was removed during the workspace redesign,
so this PR does not restore or alter that obsolete booking-link surface. The
Auth signup, reset, and staff-join callbacks preserve the current QA/Preview
behavior while Production has no explicit canonical setting. Once Production
sets `GLOWFLOW_CANONICAL_ORIGIN`, these actions refuse to send Auth email unless
`GLOWFLOW_APP_URL` is explicitly set to the same valid HTTPS origin. This does
not configure Supabase's Auth redirect allowlist: verify that separately before
beauty launch. The Resend adapter still
names `email.glowflow.mocktar.com`; a dedicated verified beauty sending domain,
monitored reply-to, restricted key, and separate approval remain GLOW-9/GLOW-55
gates. This document does not activate or reconfigure the sender.

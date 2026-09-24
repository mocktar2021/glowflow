# GLOW-23 unpublished salon sandbox fix

Owner-only sandbox checkout rejected unpublished profiles with HTTP 409. This forward migration removes only the publication prerequisite from reserve_stripe_sandbox_booking. It preserves API owner checks, service-role-only RPC access, RLS, market/service checks, conflict constraints and public booking rules. No profile is published.

Regression coverage reproduces the old failure, applies the fix, creates a reservation and checks the profile stays unpublished, then runs existing role, overlap, retry and event reconciliation tests.

Validation: 26 targeted Node tests passed. PostgreSQL 14 database assertions passed; its Windows runner then failed during disposable database cleanup. Linux CI must verify the complete runner. No UI code changed.

Apply only 20260913160600_allow_unpublished_sandbox_reservations.sql. Rollback: restore the reservation function from 20260910232219_add_stripe_sandbox_reservations.sql using CREATE OR REPLACE, preserving grants and ledger rows. Never replay the migration directory.

Preview setup and unsigned/signed non-payment probes are verified. On September 13, 2026, the function update was applied and PR 35 merged. Linux CI validation, booking browser checks, and database authorization checks passed.

The owner completed a USD 25 sandbox checkout. Reservation `fb616a65-786d-49fd-b38a-d30352203ef7` became `paid` on receipt of `checkout.session.completed` at 22:16:36 UTC. An earlier session correctly became `expired` on receipt of `checkout.session.expired`. This verifies the deployed sandbox Checkout-to-webhook path, not live payments, refunds, cash checkout, or production financial readiness.

The Test service had no eligible staff assignment. With the owner's authorization, GlowFlow Sandbox Staff was created and assigned to it, with 09:00–17:00 working hours. The fixture has a fictional `.invalid` email, no password, and disabled sign-in. The salon profile remains unpublished. These fixture records are in the shared project and should be retired before the salon is published.

Jira: https://mocktarltd.atlassian.net/browse/GLOW-23

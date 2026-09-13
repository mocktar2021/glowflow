# GLOW-23 unpublished salon sandbox fix

Owner-only sandbox checkout rejected unpublished profiles with HTTP 409. This forward migration removes only the publication prerequisite from reserve_stripe_sandbox_booking. It preserves API owner checks, service-role-only RPC access, RLS, market/service checks, conflict constraints and public booking rules. No profile is published.

Regression coverage reproduces the old failure, applies the fix, creates a reservation and checks the profile stays unpublished, then runs existing role, overlap, retry and event reconciliation tests.

Validation: 26 targeted Node tests passed. PostgreSQL 14 database assertions passed; its Windows runner then failed during disposable database cleanup. Linux CI must verify the complete runner. No UI code changed.

Apply only 20260913160600_allow_unpublished_sandbox_reservations.sql. Rollback: restore the reservation function from 20260910232219_add_stripe_sandbox_reservations.sql using CREATE OR REPLACE, preserving grants and ledger rows. Never replay the migration directory.

Preview setup and unsigned/signed non-payment probes are verified. Full Stripe Checkout and Stripe-originated webhook reconciliation remain pending this database fix.

Jira: https://mocktarltd.atlassian.net/browse/GLOW-23

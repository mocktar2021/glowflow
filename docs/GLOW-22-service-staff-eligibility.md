# GLOW-22 public booking service-staff eligibility

## Problem

Public availability previously considered every scheduled tenant user, even when a
service had an explicit `service_staff` allowlist. The appointment RPC also accepted
any user from the tenant. A caller could therefore select a staff member whom the
owner had not assigned to the service.

## Contract

- When a service has one or more `service_staff` rows, only those staff members may
  appear in public availability or receive a public appointment.
- When a service has no `service_staff` rows, the existing catalog contract remains:
  the whole scheduled tenant team is eligible.
- Tenant, publication, market, resource-conflict, and function-execution boundaries
  remain unchanged.

## Deployment

This change is database-only and has not been applied to a hosted project. Verify the
organization and project reference before any operation, then apply only
`supabase/migrations/20261015004638_enforce_public_service_staff_eligibility.sql`.
Do not use a blanket database push or replay older repository migrations.

After the migration, verify a disposable published service with two scheduled staff:

1. Assign only the first staff member and confirm availability returns only that member.
2. Confirm a booking for the assigned member succeeds.
3. Confirm a forged request for the second member returns `public_staff_not_eligible`.
4. Remove all assignments and confirm both scheduled members are eligible again.
5. Confirm a staff or service identifier from another tenant is rejected.

## Rollback

If the function change causes a verified regression, apply only
`supabase/rollbacks/20261015004638_restore_unrestricted_public_service_staff.sql`.
The rollback changes function definitions and no stored rows, but it deliberately
reopens the staff-eligibility defect. Re-run the five checks above and record that risk
before using the rollback in production.

## Local evidence

`tests/public-booking-service-staff.sql` runs against the repository's complete schema
and ordered migration history in a fresh disposable PostgreSQL database. It covers an
eligible booking, an ineligible forged booking, the no-assignment fallback, and
cross-tenant staff and service identifiers.

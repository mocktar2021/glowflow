# GLOW-22 public appointment slot integrity

## Problem

The public availability function generated 30-minute starts from staff working hours,
then applied station hours, service duration, sanitation buffer, exceptions, and
existing conflicts. Appointment creation previously checked only resource conflicts.
A forged API request could therefore book an off-grid minute or a time outside staff
working hours when no appointment or station conflict happened to block it.

## Contract

- A new public appointment must use a start returned by
  `get_public_booking_slots` for the same service, staff member, and tenant-local date.
- The idempotency lookup remains before slot validation so retrying a successful
  request returns its stored appointment after that appointment consumes the slot.
- The advisory lock and the resource check after the lock remain in place to reject a
  conflict created between availability lookup and confirmation.
- Staff eligibility, owner publication, tenant boundaries, trusted service duration,
  sanitation buffer, station, locale, and server-only RPC permissions remain intact.

## Deployment runbook

This database-only change has not been applied to a hosted project. Confirm the
Supabase organization `goutxcrujaxjjssbjfsn` and project reference
`rfwhqutkiztxkagbhevp`, then apply only
`supabase/migrations/20261015011001_enforce_public_booking_slot_integrity.sql` under
the existing production database approval. Do not run a blanket `supabase db push`
or replay older migrations.

With disposable records in the approved salon, verify:

1. A start currently returned for the selected service and staff confirms normally.
2. Retrying the same request key returns the same appointment and creates no duplicate.
3. A start shifted by 15 minutes returns `public_time_unavailable`.
4. A start outside the staff schedule returns `public_time_unavailable`.
5. Station hours, duration, sanitation buffer, and an existing conflict remove the
   expected slots; the slot at a non-overlapping buffer boundary remains available.
6. A staff or service identifier from another tenant remains denied.

Record the migration ledger entry, function definition, result IDs, and fixture
cleanup separately from any application deployment.

## Rollback

If the function change itself causes a verified regression, apply only
`supabase/rollbacks/20261015011001_restore_public_booking_resource_only_check.sql`.
The rollback changes no rows and preserves the service-staff eligibility protection,
but deliberately reopens forged off-grid and outside-working-hours booking. Re-run
the six checks above and record that exposure before using the rollback.

## Local evidence

`tests/public-booking-slot-integrity.sql` runs against a fresh disposable PostgreSQL
database after the baseline and every ordered migration. It covers a valid exposed
slot, idempotency, forged off-grid and outside-hours starts, station/duration/buffer
boundaries, an existing station conflict, and cross-tenant denial.

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

The only approved target is Supabase organization `goutxcrujaxjjssbjfsn`
(`Mocktar Technologies`), project `rfwhqutkiztxkagbhevp` (`glowflow`) in
`us-east-1`. Stop if any target identifier differs, if the repository commit is not
the reviewed PR revision, if migration `20261015004638` is already present with a
different name or body, or if the production ledger does not match the reconciled
history in `supabase/migration-history-map.json`.

Record `supabase --version`, the current remote migration list, the SQL fingerprint,
and the function definitions before applying anything. The normalized SHA-256 of the
reviewed migration must be
`8bc75405a10415e303733819c2ee1fa5499c7f6613ed4cd5c93e154c7b041220`.

Apply the reviewed SQL body once through Supabase `apply_migration`, using the name
`enforce_public_service_staff_eligibility`. That API assigns a generated remote
version rather than accepting the repository timestamp. Immediately list migration
history again and require exactly one new row with that name. If no row, more than one
row, an unexpected name, or any other ledger change appears, stop and investigate;
do not try to normalize an ambiguous result.

When the single generated row is verified and its version differs from the local
version, normalize migration metadata only:

```powershell
supabase migration repair --linked --status reverted <generated-version>
supabase migration repair --linked --status applied 20261015004638
```

These two repair commands must run only after confirming the linked target is
`rfwhqutkiztxkagbhevp` and must name only the generated version and
`20261015004638`. They do not execute SQL. Do not use `supabase db push`. If
`apply_migration` records `20261015004638` directly, skip both repair commands.

Post-application, require the local and remote ledger to contain exactly
`20261015004638_enforce_public_service_staff_eligibility`, with no generated alias
remaining. Re-read both public booking functions and verify that their optional
`service_staff` allowlist checks match the reviewed SQL before running the behavioral
checks below. Record database application separately from the Vercel deployment.

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

If only generated-version normalization fails after the forward SQL has succeeded,
repair the ledger to the known final state rather than re-running either SQL file:
remove only the generated alias and mark only `20261015004638` applied. If the forward
SQL itself must be rolled back, capture the ledger before and after applying the
reviewed rollback body once through `apply_migration`, using the name
`restore_unrestricted_public_service_staff`. Require exactly one new generated row
with that name. After verifying both function definitions match the rollback SQL,
remove only that generated rollback row and mark only the local forward version
reverted:

```powershell
supabase migration repair --linked --status reverted <generated-rollback-version>
supabase migration repair --linked --status reverted 20261015004638
```

The final ledger must match the pre-change state with `20261015004638` pending and no
generated forward or rollback alias. Stop if the rollback produces no ledger row,
more than one row, an unexpected name, any other ledger change, or function definitions
that differ from the reviewed rollback. Do not run the rollback SQL a second time and
do not use `supabase db push`.

## Local evidence

`tests/public-booking-service-staff.sql` runs against the repository's complete schema
and ordered migration history in a fresh disposable PostgreSQL database. It covers an
eligible booking, an ineligible forged booking, the no-assignment fallback, and
cross-tenant staff and service identifiers.

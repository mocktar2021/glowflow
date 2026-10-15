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
- A fast idempotency lookup remains before slot validation. A dedicated
  tenant/request-key transaction lock and authoritative second lookup make
  simultaneous retries converge even when their requested starts differ.
- The separate tenant/start resource lock and the resource check after it remain in
  place to reject a conflict created between availability lookup and confirmation.
- Staff eligibility, owner publication, tenant boundaries, trusted service duration,
  sanitation buffer, station, locale, and server-only RPC permissions remain intact.

## Deployment runbook

This database-only change has not been applied to a hosted project. The only approved
target is Supabase organization `goutxcrujaxjjssbjfsn` (`Mocktar Technologies`),
project `rfwhqutkiztxkagbhevp` (`glowflow`) in `us-east-1`. Never run it against
MowFlow. Apply only
`supabase/migrations/20261015011001_enforce_public_booking_slot_integrity.sql` under
the existing production database approval. Do not run `supabase db push` or replay
older migrations.

Stop if any target identifier differs, if the repository commit is not the reviewed
PR revision, if migrations `20261015003325` and `20261015004638` are not already
aligned locally and remotely, if migration `20261015011001` is already present with a
different name or body, or if the production ledger differs from
`supabase/migration-history-map.json` in any other way.

Record `supabase --version`, the current remote migration list, the reviewed commit,
the SQL fingerprint, and the `create_public_appointment` function definition before
applying anything. The normalized SHA-256 of the reviewed migration must be
`fda0106677a3e3e84e174fa8aca04eb81ea7b2e6787018bd201da4bb7c389d2b`.

Send the reviewed SQL body once through Supabase `apply_migration` for project
`rfwhqutkiztxkagbhevp`, using the name
`enforce_public_booking_slot_integrity`. That API can assign a generated remote
version rather than the repository timestamp. Immediately list migration history
again and compare it with the captured preflight list. Require exactly one new row
whose name is `enforce_public_booking_slot_integrity` and whose version is a 14-digit
timestamp. If no row, more than one row, an unexpected name, or any unrelated ledger
change appears, stop and retain the evidence; do not normalize an ambiguous result or
run the migration SQL again.

After verifying that the function definition matches the reviewed SQL, normalize
migration metadata only when the single generated version differs from the local
version:

```powershell
supabase migration repair --linked --project-ref rfwhqutkiztxkagbhevp --status reverted <generated-version>
supabase migration repair --linked --project-ref rfwhqutkiztxkagbhevp --status applied 20261015011001
```

These commands change ledger metadata only and must name only the verified generated
version and `20261015011001`. If `apply_migration` records `20261015011001` directly,
skip both commands. If either repair fails, stop and retain both ledger snapshots
rather than retrying the schema change.

Post-application, require local and remote history to contain exactly
`20261015011001_enforce_public_booking_slot_integrity`, with no generated alias. A
read-only final check may use
`supabase db push --linked --project-ref rfwhqutkiztxkagbhevp --dry-run --skip-vault`
and must report no pending migrations. Record database application separately from
the Vercel deployment.

With disposable records in the approved salon, verify:

1. A start currently returned for the selected service and staff confirms normally.
2. Sequential and simultaneous retries with the same request key return the same
   appointment and create no duplicate, including when the retry start drifts.
3. A start shifted by 15 minutes returns `public_time_unavailable`.
4. A start outside the staff schedule returns `public_time_unavailable`.
5. Station hours, duration, sanitation buffer, and an existing conflict remove the
   expected slots; the slot at a non-overlapping buffer boundary remains available.
6. A staff or service identifier from another tenant remains denied.

Record the migration ledger entry, function definition, result IDs, and fixture
cleanup separately from any application deployment.

## Rollback

If only generated-version normalization fails after the forward SQL succeeds, repair
the ledger to the known final state by removing only the verified generated alias and
marking only `20261015011001` applied. Do not run either SQL file again.

If the function change itself causes a verified regression, obtain separate rollback
approval and send only
`supabase/rollbacks/20261015011001_restore_public_booking_resource_only_check.sql`
through `apply_migration` for the same project, using the name
`restore_public_booking_resource_only_check`. Capture the ledger before and after.
Require exactly one new generated 14-digit row with that exact name; stop if no row,
more than one row, an unexpected name, or any unrelated ledger change appears.

After verifying that the function definition matches the reviewed rollback, remove
only the generated rollback row and mark only the local forward version reverted:

```powershell
supabase migration repair --linked --project-ref rfwhqutkiztxkagbhevp --status reverted <generated-rollback-version>
supabase migration repair --linked --project-ref rfwhqutkiztxkagbhevp --status reverted 20261015011001
```

The final ledger must match the pre-change state with `20261015011001` pending and no
generated forward or rollback alias. The rollback changes no rows and preserves the
service-staff eligibility protection, but deliberately reopens forged off-grid and
outside-working-hours booking and concurrent request-key racing. Re-run the six checks
above and record that exposure. Do not run the rollback SQL a second time and do not
use `supabase db push`.

## Local evidence

`tests/public-booking-slot-integrity.sql` runs against a fresh disposable PostgreSQL
database after the baseline and every ordered migration. It covers a valid exposed
slot, sequential and concurrent idempotency, forged off-grid and outside-hours starts,
station/duration/buffer boundaries, an existing station conflict, and cross-tenant
denial.

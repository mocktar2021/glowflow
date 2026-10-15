# GLOW-43 public catalog production runbook

## Scope

This change fixes the production mismatch where `/en/book/mocktar-braiding`
shows the owner-active `$45.00` service but `/en/salons/mocktar-braiding`
shows `Services coming soon`.

The anonymous profile query filters `public.services.is_active`. Production
currently omits that column from the anonymous column allowlist, so PostgREST
rejects the query. The migration grants only that column and also tightens the
existing RLS policy so anonymous users can read active services only when the
salon profile is owner-published.

## Target guard

- Supabase organization: `goutxcrujaxjjssbjfsn` (`Mocktar Technologies`)
- Supabase project: `rfwhqutkiztxkagbhevp` (`glowflow`)
- Region: `us-east-1`
- Local migration version: `20261015003325`
- Migration: `supabase/migrations/20261015003325_expose_active_services_to_public_profiles.sql`

Stop if any identifier differs. Never run this against MowFlow. Do not use a
blanket `supabase db push` and do not replay earlier migrations.

## Read-only preflight

Do not start until the GLOW-11 migration-history reconciliation is complete.
From this exact merged revision, `supabase migration list --linked` must show
the preceding 28 local and remote versions aligned and only
`20261015003325` as local-only. Stop if another local-only or remote-only
version appears. Record `supabase --version` and inspect
`supabase migration repair --help` before the change. Do not run
`supabase db push`.

Run these checks against project `rfwhqutkiztxkagbhevp`:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;

select has_column_privilege(
  'anon', 'public.services', 'is_active', 'select'
) as anon_can_filter_is_active;

select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename = 'services'
  and policyname = 'services_public_booking_select';

select s.id, s.price, s.deposit_amount, s.currency, s.is_active,
       t.slug, t.is_booking_enabled, p.is_published
from public.services s
join public.tenants t on t.id = s.tenant_id
left join public.salon_public_profiles p on p.tenant_id = t.id
where t.slug = 'mocktar-braiding';
```

Expected before application: the privilege check is false; the service is
active with price `4500`, deposit `2500`, and currency `USD`; the salon profile
is published and booking-enabled.

## Approved application and version normalization

After explicit production-database approval, send only the exact contents of
the named migration to the Supabase `apply_migration` API for project
`rfwhqutkiztxkagbhevp`, using the name
`expose_active_services_to_public_profiles`. Do not use `db push`, replay the
baseline, or include any other migration.

`apply_migration` can assign a generated remote timestamp rather than the
checked-in version. Immediately after it returns:

1. Read `supabase_migrations.schema_migrations` again and compare it with the
   captured preflight list.
2. Require exactly one new row whose name is
   `expose_active_services_to_public_profiles` and whose version is a 14-digit
   timestamp. Stop without repairing history if there is no new row, more than
   one new row, an unexpected name, or any unrelated ledger change.
3. Verify the privilege and policy checks below before changing the ledger.
4. If the generated version already equals `20261015003325`, skip repair.
   Otherwise replace only that generated ledger marker with the repository
   version:

```powershell
supabase migration repair --linked --status reverted <generated-version>
supabase migration repair --linked --status applied 20261015003325
```

These two repair commands change migration metadata only; the migration SQL
has already run once through `apply_migration`. Never repair an unrecognized
version. If either repair command fails, stop and retain both ledger snapshots
for recovery rather than retrying the schema change.

## Verification

1. Confirm the anonymous `is_active` column privilege is true.
2. As `anon`, query the published tenant's active service columns and confirm
   exactly the owner-active service is returned.
3. As `anon`, query an unpublished fixture tenant and confirm no rows return.
4. Load the public profile in FR, EN, and ES. Confirm the service, 60-minute
   duration, `$45.00` price, and `$25.00` deposit agree with the booking page.
5. Follow the profile's service link and confirm the same service is selected.
6. Re-run security advisors and the focused local database authorization test.
7. Run `supabase migration list --linked` and require all 29 repository and
   remote versions to align, including `20261015003325` on both sides. A
   `supabase db push --linked --dry-run` may be used only as a read-only final
   check and must report no pending migrations.

## Rollback

After separate rollback approval, send only
`supabase/rollbacks/20261015003325_hide_active_services_from_public_profiles.sql`
to `apply_migration` for the same project, using the name
`rollback_hide_active_services_from_public_profiles`. Do not run `db push`.
Capture the ledger immediately before and after the rollback. Require exactly
one new 14-digit version with that exact rollback name; stop without repairing
history if any other row changed.

After verifying that anonymous `is_active` access is false, the prior policy is
restored, and the public profile again hides service rows, return the ledger to
the pre-change pending state:

```powershell
supabase migration repair --linked --status reverted <generated-rollback-version>
supabase migration repair --linked --status reverted 20261015003325
```

The first command removes only the generated rollback marker and the second
marks the checked-in forward migration pending again. Then require
`supabase migration list --linked` to show the preceding 28 versions aligned
and only `20261015003325` as local-only. Stop on an unexpected name, version,
policy, privilege, or ledger diff and retain all before/after evidence. The
rollback revokes anonymous access to `is_active` and restores the prior service
policy; the admin-backed booking route remains available.

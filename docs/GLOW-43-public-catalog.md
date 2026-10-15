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
- Migration: `20261015003325_expose_active_services_to_public_profiles.sql`

Stop if any identifier differs. Never run this against MowFlow. Do not use a
blanket `supabase db push` and do not replay earlier migrations.

## Read-only preflight

Run these checks against project `rfwhqutkiztxkagbhevp`:

```sql
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

## Approved application

After explicit production-database approval, apply only the SQL in the named
migration through the Supabase migration API. Record the returned remote
migration version separately from this repository filename.

## Verification

1. Confirm the anonymous `is_active` column privilege is true.
2. As `anon`, query the published tenant's active service columns and confirm
   exactly the owner-active service is returned.
3. As `anon`, query an unpublished fixture tenant and confirm no rows return.
4. Load the public profile in FR, EN, and ES. Confirm the service, 60-minute
   duration, `$45.00` price, and `$25.00` deposit agree with the booking page.
5. Follow the profile's service link and confirm the same service is selected.
6. Re-run security advisors and the focused local database authorization test.

## Rollback

Apply only
`supabase/rollbacks/20261015003325_hide_active_services_from_public_profiles.sql`.
This revokes anonymous access to `is_active` and restores the prior service
policy. The public profile will again hide all services; the admin-backed
booking route remains available. Verify the privilege is false and the profile
shows no service rows. Preserve any migration-history record and document the
rollback as a new production operation.

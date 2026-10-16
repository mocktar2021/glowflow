-- GLOW-43: let anonymous public profiles read the owner-published active
-- service catalog. The explicit column grant is required because the public
-- profile query filters on is_active. Keep the RLS policy aligned with salon
-- publication so an unpublished tenant's catalog cannot be enumerated.

drop policy if exists services_public_booking_select on public.services;
create policy services_public_booking_select
on public.services for select
to anon
using (
  is_active = true
  and exists (
    select 1
    from public.tenants
    join public.markets on markets.country_code = tenants.country_code
    join public.salon_public_profiles on salon_public_profiles.tenant_id = tenants.id
    where tenants.id = services.tenant_id
      and tenants.is_booking_enabled = true
      and markets.status = 'active'
      and salon_public_profiles.is_published = true
  )
);

grant select (is_active) on public.services to anon;

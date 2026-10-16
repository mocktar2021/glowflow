-- Roll back GLOW-43 while preserving the pre-existing anonymous catalog rule.

revoke select (is_active) on public.services from anon;

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
    where tenants.id = services.tenant_id
      and tenants.is_booking_enabled = true
      and markets.status = 'active'
  )
);

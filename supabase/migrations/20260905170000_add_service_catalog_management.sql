-- GLOW-17: owner-managed service catalog with eligible staff assignments.
-- Monetary values remain in minor units.

alter table public.services
  add column if not exists currency text,
  add column if not exists updated_at timestamptz not null default now();

update public.services as service
set currency = tenant.currency
from public.tenants as tenant
where tenant.id = service.tenant_id
  and service.currency is null;

alter table public.services
  alter column currency set not null;

alter table public.services
  add constraint services_currency_format_check
  check (currency ~ '^[A-Z]{3}$');

create table if not exists public.service_staff (
  service_id uuid not null,
  staff_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (service_id, staff_id),
  foreign key (service_id, tenant_id)
    references public.services(id, tenant_id) on delete cascade,
  foreign key (staff_id, tenant_id)
    references public.users(id, tenant_id) on delete cascade
);

create index if not exists service_staff_tenant_service_idx
  on public.service_staff (tenant_id, service_id);

alter table public.service_staff enable row level security;

drop policy if exists services_tenant_insert on public.services;
drop policy if exists services_tenant_update on public.services;
drop policy if exists services_tenant_delete on public.services;

create policy services_owner_insert
on public.services for insert to authenticated
with check ((select private.is_tenant_owner(tenant_id)));

create policy services_owner_update
on public.services for update to authenticated
using ((select private.is_tenant_owner(tenant_id)))
with check ((select private.is_tenant_owner(tenant_id)));

create policy services_owner_delete
on public.services for delete to authenticated
using ((select private.is_tenant_owner(tenant_id)));

create policy service_staff_tenant_select
on public.service_staff for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy service_staff_owner_insert
on public.service_staff for insert to authenticated
with check ((select private.is_tenant_owner(tenant_id)));

create policy service_staff_owner_update
on public.service_staff for update to authenticated
using ((select private.is_tenant_owner(tenant_id)))
with check ((select private.is_tenant_owner(tenant_id)));

create policy service_staff_owner_delete
on public.service_staff for delete to authenticated
using ((select private.is_tenant_owner(tenant_id)));

revoke all on public.service_staff from anon, authenticated;
grant select, insert, update, delete on public.service_staff to authenticated;

revoke update on public.services from authenticated;
grant update (
  title_json,
  duration_minutes,
  sanitation_buffer_minutes,
  price,
  deposit_amount,
  category,
  station_name,
  is_active,
  currency,
  updated_at
) on public.services to authenticated;

revoke select on public.services from anon;
grant select (
  id,
  tenant_id,
  title_json,
  duration_minutes,
  sanitation_buffer_minutes,
  price,
  deposit_amount,
  category,
  station_name,
  currency
) on public.services to anon;

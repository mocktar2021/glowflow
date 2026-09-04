-- GlowFlow core schema for a fresh Supabase project.
-- Monetary values use minor units, for example 7200 = EUR 72.00.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'),
  owner_id uuid not null references auth.users(id) on delete restrict,
  primary_language text not null default 'fr' check (primary_language in ('fr', 'en', 'es')),
  currency text not null default 'EUR' check (currency in ('EUR', 'USD')),
  time_zone text not null default 'Europe/Paris',
  stripe_account_id text unique,
  is_booking_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  locale text not null default 'fr' check (locale in ('fr', 'en', 'es')),
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, email)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone text,
  email text,
  notes text,
  hair_formulas jsonb not null default '[]'::jsonb check (jsonb_typeof(hair_formulas) = 'array'),
  nail_preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(nail_preferences) = 'object'),
  patch_test_history jsonb not null default '[]'::jsonb check (jsonb_typeof(patch_test_history) = 'array'),
  preferred_locale text not null default 'fr' check (preferred_locale in ('fr', 'en', 'es')),
  created_at timestamptz not null default now(),
  unique (id, tenant_id)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title_json jsonb not null check (
    jsonb_typeof(title_json) = 'object'
    and title_json ? 'fr'
  ),
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  sanitation_buffer_minutes integer not null default 0 check (sanitation_buffer_minutes between 0 and 120),
  price integer not null check (price >= 0),
  deposit_amount integer not null default 0 check (deposit_amount between 0 and price),
  category text not null check (category in ('hair', 'nails', 'other')),
  station_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, tenant_id)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null,
  service_id uuid not null,
  staff_id uuid not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'completed', 'canceled', 'no_show')),
  deposit_paid boolean not null default false,
  stripe_checkout_session_id text unique,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (id, tenant_id),
  foreign key (client_id, tenant_id) references public.clients(id, tenant_id) on delete restrict,
  foreign key (service_id, tenant_id) references public.services(id, tenant_id) on delete restrict,
  foreign key (staff_id, tenant_id) references public.users(id, tenant_id) on delete restrict
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid,
  invoice_number text not null,
  total_amount integer not null check (total_amount >= 0),
  tva_tax_amount integer not null default 0 check (tva_tax_amount between 0 and total_amount),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'refunded', 'void')),
  currency text not null check (currency in ('EUR', 'USD')),
  stripe_payment_intent_id text unique,
  issued_at timestamptz not null default now(),
  unique (tenant_id, invoice_number),
  foreign key (appointment_id, tenant_id) references public.appointments(id, tenant_id) on delete restrict
);

create index clients_tenant_name_idx on public.clients (tenant_id, full_name);
create index services_tenant_active_idx on public.services (tenant_id, is_active);
create index tenants_owner_idx on public.tenants (owner_id);
create index appointments_tenant_start_idx on public.appointments (tenant_id, start_time);
create index appointments_client_tenant_idx on public.appointments (client_id, tenant_id);
create index appointments_service_tenant_idx on public.appointments (service_id, tenant_id);
create index appointments_staff_tenant_start_idx on public.appointments (staff_id, tenant_id, start_time);
create index invoices_tenant_issued_idx on public.invoices (tenant_id, issued_at desc);
create index invoices_appointment_tenant_idx on public.invoices (appointment_id, tenant_id);

create or replace function private.is_tenant_member(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users as membership
    where membership.id = (select auth.uid())
      and membership.tenant_id = target_tenant_id
  );
$$;

create or replace function private.is_tenant_owner(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenants as tenant
    where tenant.id = target_tenant_id
      and tenant.owner_id = (select auth.uid())
  );
$$;

revoke all on function private.is_tenant_member(uuid) from public, anon;
revoke all on function private.is_tenant_owner(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_tenant_member(uuid) to authenticated;
grant execute on function private.is_tenant_owner(uuid) to authenticated;

alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.clients enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;
alter table public.invoices enable row level security;

create policy tenants_member_select
on public.tenants for select to authenticated
using ((select private.is_tenant_member(id)));

create policy tenants_public_booking_select
on public.tenants for select to anon
using (is_booking_enabled = true);

create policy tenants_owner_insert
on public.tenants for insert to authenticated
with check (owner_id = (select auth.uid()));

create policy tenants_owner_update
on public.tenants for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy tenants_owner_delete
on public.tenants for delete to authenticated
using (owner_id = (select auth.uid()));

create policy users_tenant_select
on public.users for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy users_owner_or_self_insert
on public.users for insert to authenticated
with check (
  (id = (select auth.uid()) and (select private.is_tenant_owner(tenant_id)))
  or (role = 'staff' and (select private.is_tenant_owner(tenant_id)))
);

create policy users_owner_or_self_update
on public.users for update to authenticated
using (id = (select auth.uid()) or (select private.is_tenant_owner(tenant_id)))
with check (id = (select auth.uid()) or (select private.is_tenant_owner(tenant_id)));

create policy users_owner_delete
on public.users for delete to authenticated
using ((select private.is_tenant_owner(tenant_id)) and id <> (select auth.uid()));

create policy clients_tenant_select
on public.clients for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy clients_tenant_insert
on public.clients for insert to authenticated
with check ((select private.is_tenant_member(tenant_id)));

create policy clients_tenant_update
on public.clients for update to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

create policy clients_tenant_delete
on public.clients for delete to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy services_tenant_select
on public.services for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy services_public_booking_select
on public.services for select to anon
using (
  is_active = true
  and exists (
    select 1 from public.tenants
    where tenants.id = services.tenant_id
      and tenants.is_booking_enabled = true
  )
);

create policy services_tenant_insert
on public.services for insert to authenticated
with check ((select private.is_tenant_member(tenant_id)));

create policy services_tenant_update
on public.services for update to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

create policy services_tenant_delete
on public.services for delete to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy appointments_tenant_select
on public.appointments for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy appointments_tenant_insert
on public.appointments for insert to authenticated
with check ((select private.is_tenant_member(tenant_id)));

create policy appointments_tenant_update
on public.appointments for update to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

create policy appointments_tenant_delete
on public.appointments for delete to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy invoices_tenant_select
on public.invoices for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy invoices_tenant_insert
on public.invoices for insert to authenticated
with check ((select private.is_tenant_member(tenant_id)));

create policy invoices_tenant_update
on public.invoices for update to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

create policy invoices_tenant_delete
on public.invoices for delete to authenticated
using ((select private.is_tenant_owner(tenant_id)));

revoke all on public.tenants, public.users, public.clients, public.services, public.appointments, public.invoices from anon, authenticated;

grant select, insert, delete on public.tenants to authenticated;
grant update (name, primary_language, currency, time_zone, is_booking_enabled) on public.tenants to authenticated;

grant select, insert, delete on public.users to authenticated;
grant update (full_name, locale) on public.users to authenticated;

grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.services to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;
grant select, insert, update, delete on public.invoices to authenticated;

grant select (id, name, slug, primary_language, currency, time_zone, is_booking_enabled) on public.tenants to anon;
grant select (id, tenant_id, title_json, duration_minutes, sanitation_buffer_minutes, price, deposit_amount, category, station_name) on public.services to anon;

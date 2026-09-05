-- GlowFlow core schema for a fresh Supabase project.
-- Monetary values use minor units, for example 7200 = EUR 72.00.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon;

create table public.markets (
  country_code text primary key check (country_code ~ '^[A-Z]{2}
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'),
  owner_id uuid not null references auth.users(id) on delete restrict,
  country_code text not null references public.markets(country_code) on update cascade on delete restrict,
  address_line1 text,
  address_line2 text,
  city text,
  administrative_area text,
  postal_code text,
  primary_language text not null default 'fr' check (primary_language in ('fr', 'en', 'es')),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}
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

create index tenants_country_city_idx on public.tenants (country_code, city);
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

alter table public.markets enable row level security;
alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.clients enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;
alter table public.invoices enable row level security;

create policy markets_active_select
on public.markets for select to anon, authenticated
using (status = 'active');

create policy tenants_member_select
on public.tenants for select to authenticated
using ((select private.is_tenant_member(id)));

create policy tenants_public_booking_select
on public.tenants for select to anon
using (
  is_booking_enabled = true
  and exists (
    select 1 from public.markets
    where markets.country_code = tenants.country_code
      and markets.status = 'active'
  )
);

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
    join public.markets on markets.country_code = tenants.country_code
    where tenants.id = services.tenant_id
      and tenants.is_booking_enabled = true
      and markets.status = 'active'
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

revoke all on public.markets, public.tenants, public.users, public.clients, public.services, public.appointments, public.invoices from anon, authenticated;

grant select (country_code, name_json, supported_locales, default_locale, currency, default_time_zone, supported_time_zones, address_format, tax_config, payment_methods, status) on public.markets to anon, authenticated;

grant select, insert, delete on public.tenants to authenticated;
grant update (name, primary_language, address_line1, address_line2, city, administrative_area, postal_code, is_booking_enabled) on public.tenants to authenticated;

grant select, insert, delete on public.users to authenticated;
grant update (full_name, locale) on public.users to authenticated;

grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.services to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;
grant select, insert, update, delete on public.invoices to authenticated;

grant select (id, name, slug, country_code, address_line1, address_line2, city, administrative_area, postal_code, primary_language, currency, time_zone, is_booking_enabled) on public.tenants to anon;
grant select (id, tenant_id, title_json, duration_minutes, sanitation_buffer_minutes, price, deposit_amount, category, station_name) on public.services to anon;
),
  name_json jsonb not null check (
    jsonb_typeof(name_json) = 'object'
    and name_json ?& array['fr', 'en', 'es']
  ),
  supported_locales text[] not null check (
    cardinality(supported_locales) > 0
    and supported_locales <@ array['fr', 'en', 'es']::text[]
  ),
  default_locale text not null check (default_locale in ('fr', 'en', 'es')),
  currency text not null check (currency ~ '^[A-Z]{3}
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
),
  default_time_zone text not null,
  supported_time_zones text[] not null check (cardinality(supported_time_zones) > 0),
  address_format jsonb not null check (jsonb_typeof(address_format) = 'object'),
  tax_config jsonb not null check (jsonb_typeof(tax_config) = 'object'),
  payment_methods text[] not null default array['cash']::text[],
  status text not null default 'inactive' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (default_locale = any(supported_locales)),
  check (default_time_zone = any(supported_time_zones))
);

insert into public.markets (
  country_code, name_json, supported_locales, default_locale, currency,
  default_time_zone, supported_time_zones, address_format, tax_config,
  payment_methods, status
)
values
  ('FR', '{"fr":"France","en":"France","es":"Francia"}', array['fr','en','es'], 'fr', 'EUR',
   'Europe/Paris', array['Europe/Paris'],
   '{"fields":["address_line1","postal_code","city"],"postal_code_pattern":"^[0-9]{5}$","postal_code_label":"Code postal"}',
   '{"mode":"vat","label":"TVA","rate_source":"salon_configuration","prices_include_tax":true}',
   array['card','cash'], 'active'),
  ('US', '{"fr":"États-Unis","en":"United States","es":"Estados Unidos"}', array['fr','en','es'], 'en', 'USD',
   'America/New_York', array['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Anchorage','Pacific/Honolulu'],
   '{"fields":["address_line1","city","administrative_area","postal_code"],"postal_code_pattern":"^[0-9]{5}(-[0-9]{4})?$","postal_code_label":"ZIP code"}',
   '{"mode":"sales_tax","label":"Sales tax","rate_source":"jurisdiction","prices_include_tax":false}',
   array['card','cash'], 'active'),
  ('ES', '{"fr":"Espagne","en":"Spain","es":"España"}', array['fr','en','es'], 'es', 'EUR',
   'Europe/Madrid', array['Europe/Madrid','Atlantic/Canary'],
   '{"fields":["address_line1","postal_code","city","administrative_area"],"postal_code_pattern":"^[0-9]{5}$","postal_code_label":"Código postal"}',
   '{"mode":"vat","label":"IVA","rate_source":"salon_configuration","prices_include_tax":true}',
   array['card','cash'], 'active');

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
),
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
),
  name_json jsonb not null check (
    jsonb_typeof(name_json) = 'object'
    and name_json ?& array['fr', 'en', 'es']
  ),
  supported_locales text[] not null check (
    cardinality(supported_locales) > 0
    and supported_locales <@ array['fr', 'en', 'es']::text[]
  ),
  default_locale text not null check (default_locale in ('fr', 'en', 'es')),
  currency text not null check (currency ~ '^[A-Z]{3}
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
),
  default_time_zone text not null,
  supported_time_zones text[] not null check (cardinality(supported_time_zones) > 0),
  address_format jsonb not null check (jsonb_typeof(address_format) = 'object'),
  tax_config jsonb not null check (jsonb_typeof(tax_config) = 'object'),
  payment_methods text[] not null default array['cash']::text[],
  status text not null default 'inactive' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (default_locale = any(supported_locales)),
  check (default_time_zone = any(supported_time_zones))
);

insert into public.markets (
  country_code, name_json, supported_locales, default_locale, currency,
  default_time_zone, supported_time_zones, address_format, tax_config,
  payment_methods, status
)
values
  ('FR', '{"fr":"France","en":"France","es":"Francia"}', array['fr','en','es'], 'fr', 'EUR',
   'Europe/Paris', array['Europe/Paris'],
   '{"fields":["address_line1","postal_code","city"],"postal_code_pattern":"^[0-9]{5}$","postal_code_label":"Code postal"}',
   '{"mode":"vat","label":"TVA","rate_source":"salon_configuration","prices_include_tax":true}',
   array['card','cash'], 'active'),
  ('US', '{"fr":"États-Unis","en":"United States","es":"Estados Unidos"}', array['fr','en','es'], 'en', 'USD',
   'America/New_York', array['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Anchorage','Pacific/Honolulu'],
   '{"fields":["address_line1","city","administrative_area","postal_code"],"postal_code_pattern":"^[0-9]{5}(-[0-9]{4})?$","postal_code_label":"ZIP code"}',
   '{"mode":"sales_tax","label":"Sales tax","rate_source":"jurisdiction","prices_include_tax":false}',
   array['card','cash'], 'active'),
  ('ES', '{"fr":"Espagne","en":"Spain","es":"España"}', array['fr','en','es'], 'es', 'EUR',
   'Europe/Madrid', array['Europe/Madrid','Atlantic/Canary'],
   '{"fields":["address_line1","postal_code","city","administrative_area"],"postal_code_pattern":"^[0-9]{5}$","postal_code_label":"Código postal"}',
   '{"mode":"vat","label":"IVA","rate_source":"salon_configuration","prices_include_tax":true}',
   array['card','cash'], 'active');

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

-- GLOW-41: public salon discovery and indexed marketplace search.

create table public.salon_public_profiles (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'),
  business_name text not null check (char_length(business_name) between 2 and 120),
  description_json jsonb not null default '{}'::jsonb check (jsonb_typeof(description_json) = 'object'),
  country_code text not null references public.markets(country_code) on update cascade on delete restrict,
  city text not null check (char_length(city) between 2 and 120),
  postal_code text not null check (char_length(postal_code) between 2 and 24),
  categories text[] not null default '{}'::text[] check (
    categories <@ array['hair', 'nails', 'other']::text[]
  ),
  product_keywords text[] not null default '{}'::text[],
  image_url text,
  next_available_at timestamptz,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(business_name, '') || ' ' ||
      coalesce(description_json::text, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(postal_code, '') || ' ' ||
      coalesce(array_to_string(categories, ' '), '') || ' ' ||
      coalesce(array_to_string(product_keywords, ' '), '')
    )
  ) stored,
  check (
    (is_published = false)
    or (published_at is not null and cardinality(categories) > 0)
  )
);

create index salon_public_profiles_search_idx
  on public.salon_public_profiles using gin (search_vector);
create index salon_public_profiles_market_city_idx
  on public.salon_public_profiles (country_code, lower(city), postal_code)
  where is_published = true;
create index salon_public_profiles_availability_idx
  on public.salon_public_profiles (next_available_at)
  where is_published = true;
create index services_public_title_search_idx
  on public.services using gin (to_tsvector('simple', title_json::text))
  where is_active = true;

alter table public.salon_public_profiles enable row level security;

create policy salon_public_profiles_public_select
on public.salon_public_profiles for select
to anon, authenticated
using (
  is_published = true
  and exists (
    select 1
    from public.tenants
    join public.markets on markets.country_code = tenants.country_code
    where tenants.id = salon_public_profiles.tenant_id
      and tenants.is_booking_enabled = true
      and markets.status = 'active'
  )
);

create policy salon_public_profiles_tenant_select
on public.salon_public_profiles for select
to authenticated
using (
  tenant_id in (
    select users.tenant_id
    from public.users
    where users.id = (select auth.uid())
  )
);

create policy salon_public_profiles_tenant_insert
on public.salon_public_profiles for insert
to authenticated
with check (
  tenant_id in (
    select users.tenant_id
    from public.users
    where users.id = (select auth.uid())
      and users.role = 'owner'
  )
);

create policy salon_public_profiles_tenant_update
on public.salon_public_profiles for update
to authenticated
using (
  tenant_id in (
    select users.tenant_id
    from public.users
    where users.id = (select auth.uid())
      and users.role = 'owner'
  )
)
with check (
  tenant_id in (
    select users.tenant_id
    from public.users
    where users.id = (select auth.uid())
      and users.role = 'owner'
  )
);

create policy salon_public_profiles_tenant_delete
on public.salon_public_profiles for delete
to authenticated
using (
  tenant_id in (
    select users.tenant_id
    from public.users
    where users.id = (select auth.uid())
      and users.role = 'owner'
  )
);

revoke all on public.salon_public_profiles from anon, authenticated;
grant select on public.salon_public_profiles to anon;
grant select, insert, update, delete on public.salon_public_profiles to authenticated;

create function public.search_public_salons(
  search_text text default null,
  filter_country_code text default null,
  filter_city text default null,
  filter_postal_code text default null,
  filter_category text default null,
  maximum_price integer default null,
  available_before timestamptz default null,
  page_size integer default 12,
  page_offset integer default 0
)
returns table (
  slug text,
  business_name text,
  description_json jsonb,
  country_code text,
  city text,
  postal_code text,
  categories text[],
  product_keywords text[],
  image_url text,
  next_available_at timestamptz,
  starting_price integer,
  currency text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with matching as (
    select
      profile.slug,
      profile.business_name,
      profile.description_json,
      profile.country_code,
      profile.city,
      profile.postal_code,
      profile.categories,
      profile.product_keywords,
      profile.image_url,
      profile.next_available_at,
      service_summary.starting_price,
      market.currency,
      case
        when nullif(trim(search_text), '') is null then 0::real
        else ts_rank(profile.search_vector, websearch_to_tsquery('simple', trim(search_text)))
      end as relevance
    from public.salon_public_profiles as profile
    join public.markets as market
      on market.country_code = profile.country_code
     and market.status = 'active'
    left join lateral (
      select min(service.price)::integer as starting_price
      from public.services as service
      where service.tenant_id = profile.tenant_id
        and service.is_active = true
        and (filter_category is null or service.category = filter_category)
        and (maximum_price is null or service.price <= maximum_price)
    ) as service_summary on true
    where profile.is_published = true
      and (filter_country_code is null or profile.country_code = upper(filter_country_code))
      and (filter_city is null or lower(profile.city) = lower(trim(filter_city)))
      and (filter_postal_code is null or profile.postal_code = trim(filter_postal_code))
      and (filter_category is null or filter_category = any(profile.categories))
      and (available_before is null or profile.next_available_at <= available_before)
      and (
        (filter_category is null and maximum_price is null)
        or service_summary.starting_price is not null
      )
      and (
        nullif(trim(search_text), '') is null
        or profile.search_vector @@ websearch_to_tsquery('simple', trim(search_text))
        or exists (
          select 1
          from public.services as matching_service
          where matching_service.tenant_id = profile.tenant_id
            and matching_service.is_active = true
            and to_tsvector('simple', matching_service.title_json::text)
                @@ websearch_to_tsquery('simple', trim(search_text))
        )
      )
  )
  select
    matching.slug,
    matching.business_name,
    matching.description_json,
    matching.country_code,
    matching.city,
    matching.postal_code,
    matching.categories,
    matching.product_keywords,
    matching.image_url,
    matching.next_available_at,
    matching.starting_price,
    matching.currency,
    count(*) over() as total_count
  from matching
  order by matching.relevance desc, matching.next_available_at asc nulls last, matching.business_name
  limit least(greatest(page_size, 1), 48)
  offset greatest(page_offset, 0);
$$;

revoke all on function public.search_public_salons(text, text, text, text, text, integer, timestamptz, integer, integer)
from public;
grant execute on function public.search_public_salons(text, text, text, text, text, integer, timestamptz, integer, integer)
to anon, authenticated;

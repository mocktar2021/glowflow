-- GLOW-40: multi-country market configuration.
-- Existing EUR tenants are backfilled to France and USD tenants to the United States.

create table public.markets (
  country_code text primary key check (country_code ~ '^[A-Z]{2}$'),
  name_json jsonb not null check (
    jsonb_typeof(name_json) = 'object'
    and name_json ?& array['fr', 'en', 'es']
  ),
  supported_locales text[] not null check (
    cardinality(supported_locales) > 0
    and supported_locales <@ array['fr', 'en', 'es']::text[]
  ),
  default_locale text not null check (default_locale in ('fr', 'en', 'es')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
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
  country_code,
  name_json,
  supported_locales,
  default_locale,
  currency,
  default_time_zone,
  supported_time_zones,
  address_format,
  tax_config,
  payment_methods,
  status
)
values
  (
    'FR',
    '{"fr":"France","en":"France","es":"Francia"}',
    array['fr', 'en', 'es'],
    'fr',
    'EUR',
    'Europe/Paris',
    array['Europe/Paris'],
    '{"fields":["address_line1","postal_code","city"],"postal_code_pattern":"^[0-9]{5}$","postal_code_label":"Code postal"}',
    '{"mode":"vat","label":"TVA","rate_source":"salon_configuration","prices_include_tax":true}',
    array['card', 'cash'],
    'active'
  ),
  (
    'US',
    '{"fr":"États-Unis","en":"United States","es":"Estados Unidos"}',
    array['fr', 'en', 'es'],
    'en',
    'USD',
    'America/New_York',
    array['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Anchorage','Pacific/Honolulu'],
    '{"fields":["address_line1","city","administrative_area","postal_code"],"postal_code_pattern":"^[0-9]{5}(-[0-9]{4})?$","postal_code_label":"ZIP code"}',
    '{"mode":"sales_tax","label":"Sales tax","rate_source":"jurisdiction","prices_include_tax":false}',
    array['card', 'cash'],
    'active'
  ),
  (
    'ES',
    '{"fr":"Espagne","en":"Spain","es":"España"}',
    array['fr', 'en', 'es'],
    'es',
    'EUR',
    'Europe/Madrid',
    array['Europe/Madrid','Atlantic/Canary'],
    '{"fields":["address_line1","postal_code","city","administrative_area"],"postal_code_pattern":"^[0-9]{5}$","postal_code_label":"Código postal"}',
    '{"mode":"vat","label":"IVA","rate_source":"salon_configuration","prices_include_tax":true}',
    array['card', 'cash'],
    'active'
  );

alter table public.markets enable row level security;

create policy markets_active_select
on public.markets for select
to anon, authenticated
using (status = 'active');

revoke all on public.markets from anon, authenticated;
grant select (
  country_code,
  name_json,
  supported_locales,
  default_locale,
  currency,
  default_time_zone,
  supported_time_zones,
  address_format,
  tax_config,
  payment_methods,
  status
) on public.markets to anon, authenticated;

alter table public.tenants
  add column country_code text,
  add column address_line1 text,
  add column address_line2 text,
  add column city text,
  add column administrative_area text,
  add column postal_code text;

update public.tenants
set country_code = case when currency = 'USD' then 'US' else 'FR' end,
    time_zone = case when currency = 'USD' then 'America/New_York' else 'Europe/Paris' end
where country_code is null;

alter table public.tenants
  alter column country_code set not null,
  add constraint tenants_country_code_fkey
    foreign key (country_code) references public.markets(country_code) on update cascade on delete restrict;

create index tenants_country_city_idx on public.tenants (country_code, city);

revoke update (currency, time_zone) on public.tenants from authenticated;

grant select (
  country_code,
  address_line1,
  address_line2,
  city,
  administrative_area,
  postal_code
) on public.tenants to anon;

grant update (
  name,
  primary_language,
  address_line1,
  address_line2,
  city,
  administrative_area,
  postal_code,
  is_booking_enabled
) on public.tenants to authenticated;

drop policy if exists tenants_public_booking_select on public.tenants;
create policy tenants_public_booking_select
on public.tenants for select
to anon
using (
  is_booking_enabled = true
  and exists (
    select 1
    from public.markets
    where markets.country_code = tenants.country_code
      and markets.status = 'active'
  )
);

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

drop function if exists public.create_owner_workspace(text, text, text, text, text);

create function public.create_owner_workspace(
  salon_name text,
  requested_slug text,
  owner_full_name text,
  owner_locale text default 'fr',
  salon_country_code text default 'FR',
  salon_time_zone text default 'Europe/Paris',
  salon_address_line1 text default '',
  salon_city text default '',
  salon_postal_code text default '',
  salon_administrative_area text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := nullif(auth.jwt() ->> 'email', '');
  workspace_id uuid;
  safe_slug text;
  selected_market public.markets%rowtype;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;

  if exists (select 1 from public.users where id = current_user_id) then
    select tenant_id into workspace_id from public.users where id = current_user_id;
    return workspace_id;
  end if;

  if current_email is null then raise exception 'verified_email_required'; end if;
  if char_length(trim(salon_name)) not between 2 and 120 then raise exception 'invalid_salon_name'; end if;
  if char_length(trim(owner_full_name)) not between 2 and 120 then raise exception 'invalid_owner_name'; end if;
  if owner_locale not in ('fr', 'en', 'es') then raise exception 'invalid_locale'; end if;
  if char_length(trim(salon_address_line1)) < 3 then raise exception 'invalid_address'; end if;
  if char_length(trim(salon_city)) < 2 then raise exception 'invalid_city'; end if;

  select *
  into selected_market
  from public.markets
  where country_code = upper(trim(salon_country_code))
    and status = 'active';

  if not found then raise exception 'market_unavailable'; end if;
  if not owner_locale = any(selected_market.supported_locales) then raise exception 'locale_unavailable'; end if;
  if not salon_time_zone = any(selected_market.supported_time_zones) then raise exception 'invalid_time_zone'; end if;

  if selected_market.address_format ? 'postal_code_pattern'
     and trim(salon_postal_code) !~ (selected_market.address_format ->> 'postal_code_pattern')
  then
    raise exception 'invalid_postal_code';
  end if;

  safe_slug := lower(regexp_replace(trim(requested_slug), '[^a-z0-9]+', '-', 'g'));
  safe_slug := trim(both '-' from safe_slug);

  if safe_slug = '' or safe_slug !~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' then
    safe_slug := 'salon-' || substr(replace(current_user_id::text, '-', ''), 1, 8);
  end if;

  if exists (select 1 from public.tenants where slug = safe_slug) then
    safe_slug := safe_slug || '-' || substr(replace(current_user_id::text, '-', ''), 1, 6);
  end if;

  workspace_id := gen_random_uuid();

  insert into public.tenants (
    id,
    name,
    slug,
    owner_id,
    primary_language,
    currency,
    time_zone,
    country_code,
    address_line1,
    city,
    postal_code,
    administrative_area
  )
  values (
    workspace_id,
    trim(salon_name),
    safe_slug,
    current_user_id,
    owner_locale,
    selected_market.currency,
    salon_time_zone,
    selected_market.country_code,
    trim(salon_address_line1),
    trim(salon_city),
    trim(salon_postal_code),
    nullif(trim(salon_administrative_area), '')
  );

  insert into public.users (id, tenant_id, full_name, email, role, locale)
  values (current_user_id, workspace_id, trim(owner_full_name), current_email, 'owner', owner_locale);

  return workspace_id;
end;
$$;

revoke all on function public.create_owner_workspace(text, text, text, text, text, text, text, text, text, text)
from public, anon;
grant execute on function public.create_owner_workspace(text, text, text, text, text, text, text, text, text, text)
to authenticated;

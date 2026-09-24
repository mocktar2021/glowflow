-- GLOW-36: keep owner onboarding compatible with the explicit market-column grant.
-- The function remains SECURITY INVOKER and reads only columns granted to authenticated users.

create or replace function public.create_owner_workspace(
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
  selected_market record;
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

  select country_code, supported_locales, currency, supported_time_zones, address_format
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


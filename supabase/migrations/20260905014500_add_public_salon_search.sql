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

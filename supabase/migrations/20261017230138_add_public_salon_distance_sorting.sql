-- GLOW-46: optional salon map pins and distance sort for public discovery.
-- Existing search RPCs, addresses, and publication rules remain unchanged.

create schema if not exists extensions;

do $$
begin
  if exists (
    select 1
    from pg_extension as extension
    join pg_namespace as namespace on namespace.oid = extension.extnamespace
    where extension.extname = 'postgis'
      and namespace.nspname <> 'extensions'
  ) then
    raise exception 'postgis must be installed in the extensions schema';
  end if;
end;
$$;

create extension if not exists postgis with schema extensions;

alter table public.salon_public_profiles
  add column map_latitude double precision,
  add column map_longitude double precision,
  add column location extensions.geography(Point, 4326)
    generated always as (
      case
        when map_latitude is not null and map_longitude is not null then
          extensions.st_setsrid(
            extensions.st_makepoint(map_longitude, map_latitude),
            4326
          )::extensions.geography
        else null
      end
    ) stored,
  add constraint salon_public_profiles_map_coordinates_check check (
    (map_latitude is null and map_longitude is null)
    or (
      map_latitude is not null
      and map_longitude is not null
      and map_latitude between -90 and 90
      and map_longitude between -180 and 180
    )
  );

create index salon_public_profiles_published_location_idx
  on public.salon_public_profiles using gist (location)
  where is_published = true and location is not null;

-- The public pin is owner-supplied and visible only for published profiles via RLS.
-- Keep input coordinates out of the anonymous column allowlist.
grant select (location) on public.salon_public_profiles to anon;

create function public.search_public_salons_by_distance(
  origin_lat double precision,
  origin_lon double precision,
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
  total_count bigint,
  distance_meters double precision
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  origin_point extensions.geography(Point, 4326);
begin
  if origin_lat is null or origin_lon is null
    or origin_lat not between -90 and 90
    or origin_lon not between -180 and 180
  then
    raise exception 'invalid_origin_coordinates' using errcode = '22023';
  end if;

  origin_point := extensions.st_setsrid(
    extensions.st_makepoint(origin_lon, origin_lat),
    4326
  )::extensions.geography;

  return query
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
      profile.location operator(extensions.<->) origin_point as distance_meters
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
    count(*) over() as total_count,
    matching.distance_meters
  from matching
  order by matching.distance_meters asc nulls last,
    matching.business_name,
    matching.slug
  limit least(greatest(coalesce(page_size, 12), 1), 48)
  offset greatest(coalesce(page_offset, 0), 0);
end;
$$;

revoke all on function public.search_public_salons_by_distance(
  double precision, double precision, text, text, text, text, text,
  integer, timestamptz, integer, integer
) from public;
grant execute on function public.search_public_salons_by_distance(
  double precision, double precision, text, text, text, text, text,
  integer, timestamptz, integer, integer
) to anon, authenticated;

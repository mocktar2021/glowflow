-- GLOW-46: sort public discovery before pagination without changing the existing RPC.
-- The original search_public_salons remains available during application rollout.

create function public.search_public_salons_sorted(
  sort_by text,
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
  order by
    case when sort_by = 'price_asc' and filter_country_code is not null
      then matching.starting_price end asc nulls last,
    case when sort_by = 'price_desc' and filter_country_code is not null
      then matching.starting_price end desc nulls last,
    case when sort_by = 'availability' then matching.next_available_at end asc nulls last,
    case when sort_by is null or sort_by not in ('price_asc', 'price_desc', 'availability')
      or (sort_by in ('price_asc', 'price_desc') and filter_country_code is null)
      then matching.relevance end desc,
    case when sort_by is null or sort_by not in ('price_asc', 'price_desc', 'availability')
      or (sort_by in ('price_asc', 'price_desc') and filter_country_code is null)
      then matching.next_available_at end asc nulls last,
    matching.business_name,
    matching.slug
  limit least(greatest(coalesce(page_size, 12), 1), 48)
  offset greatest(coalesce(page_offset, 0), 0);
$$;

revoke all on function public.search_public_salons_sorted(text, text, text, text, text, text, integer, timestamptz, integer, integer)
from public;
grant execute on function public.search_public_salons_sorted(text, text, text, text, text, text, integer, timestamptz, integer, integer)
to anon, authenticated;

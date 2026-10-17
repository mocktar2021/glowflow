-- GLOW-39: owner-managed product cards. No inventory counts or purchasing data
-- live in this public-facing table.
create table public.salon_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name_json jsonb not null,
  description_json jsonb not null default '{"fr":"","en":"","es":""}'::jsonb,
  image_alt_json jsonb not null default '{"fr":"","en":"","es":""}'::jsonb,
  category text not null check (category in ('hair', 'nails', 'skincare', 'accessories', 'other')),
  image_url text,
  price integer not null check (price >= 0),
  currency text not null check (currency in ('EUR', 'USD')),
  stock_visibility text not null default 'not_shown'
    check (stock_visibility in ('available', 'unavailable', 'not_shown')),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  check (jsonb_typeof(name_json) = 'object'
    and name_json - 'fr' - 'en' - 'es' = '{}'::jsonb
    and jsonb_typeof(name_json->'fr') = 'string'
    and jsonb_typeof(name_json->'en') = 'string'
    and jsonb_typeof(name_json->'es') = 'string'
    and length(trim(coalesce(name_json->>'fr', ''))) between 2 and 120
    and length(trim(coalesce(name_json->>'en', ''))) between 2 and 120
    and length(trim(coalesce(name_json->>'es', ''))) between 2 and 120),
  check (jsonb_typeof(description_json) = 'object'
    and description_json - 'fr' - 'en' - 'es' = '{}'::jsonb
    and jsonb_typeof(description_json->'fr') = 'string'
    and jsonb_typeof(description_json->'en') = 'string'
    and jsonb_typeof(description_json->'es') = 'string'
    and length(coalesce(description_json->>'fr', '')) <= 1200
    and length(coalesce(description_json->>'en', '')) <= 1200
    and length(coalesce(description_json->>'es', '')) <= 1200),
  check (jsonb_typeof(image_alt_json) = 'object'
    and image_alt_json - 'fr' - 'en' - 'es' = '{}'::jsonb
    and jsonb_typeof(image_alt_json->'fr') = 'string'
    and jsonb_typeof(image_alt_json->'en') = 'string'
    and jsonb_typeof(image_alt_json->'es') = 'string'
    and length(coalesce(image_alt_json->>'fr', '')) <= 180
    and length(coalesce(image_alt_json->>'en', '')) <= 180
    and length(coalesce(image_alt_json->>'es', '')) <= 180),
  check (image_url is null or (
    length(trim(coalesce(image_alt_json->>'fr', ''))) > 0
    and length(trim(coalesce(image_alt_json->>'en', ''))) > 0
    and length(trim(coalesce(image_alt_json->>'es', ''))) > 0
  ))
);

create index salon_products_public_listing_idx
  on public.salon_products (tenant_id, category, created_at)
  where is_published = true;
create index salon_products_owner_listing_idx
  on public.salon_products (tenant_id, created_at);

alter table public.salon_products enable row level security;

create policy salon_products_public_select
on public.salon_products for select to anon, authenticated
using (
  is_published = true
  and exists (
    select 1
    from public.salon_public_profiles as profile
    join public.tenants as tenant on tenant.id = profile.tenant_id
    join public.markets as market on market.country_code = tenant.country_code
    where profile.tenant_id = salon_products.tenant_id
      and profile.is_published = true
      and tenant.is_booking_enabled = true
      and market.status = 'active'
  )
);

create policy salon_products_owner_select
on public.salon_products for select to authenticated
using ((select private.is_tenant_owner(tenant_id)));

create policy salon_products_owner_insert
on public.salon_products for insert to authenticated
with check ((select private.is_tenant_owner(tenant_id)));

create policy salon_products_owner_update
on public.salon_products for update to authenticated
using ((select private.is_tenant_owner(tenant_id)))
with check ((select private.is_tenant_owner(tenant_id)));

create policy salon_products_owner_delete
on public.salon_products for delete to authenticated
using ((select private.is_tenant_owner(tenant_id)));

revoke all on public.salon_products from anon, authenticated;
grant select (id, tenant_id, name_json, description_json, image_alt_json,
  category, image_url, price, currency, stock_visibility, is_published, created_at)
  on public.salon_products to anon;
grant select, insert, delete on public.salon_products to authenticated;
grant update (name_json, description_json, image_alt_json, category,
  image_url, price, currency, stock_visibility, is_published, updated_at)
  on public.salon_products to authenticated;

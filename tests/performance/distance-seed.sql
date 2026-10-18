-- Synthetic local-only fixture for the GLOW-46 distance-search performance gate.
-- Run after the baseline and all ordered migrations in a disposable database.

insert into auth.users (id, email)
select md5('glow46-bench-owner-' || fixture.id)::uuid,
       'glow46-bench-' || fixture.id || '@example.invalid'
from generate_series(1, 10000) as fixture(id);

insert into public.tenants (
  id, name, slug, owner_id, country_code, currency, time_zone, city, postal_code
)
select
  md5('glow46-bench-tenant-' || fixture.id)::uuid,
  'Benchmark Salon ' || fixture.id,
  'bench-salon-' || fixture.id,
  md5('glow46-bench-owner-' || fixture.id)::uuid,
  case when fixture.id <= 4000 then 'US' when fixture.id <= 7000 then 'FR' else 'ES' end,
  case when fixture.id <= 4000 then 'USD' else 'EUR' end,
  case when fixture.id <= 4000 then 'America/New_York'
       when fixture.id <= 7000 then 'Europe/Paris' else 'Europe/Madrid' end,
  case when fixture.id <= 1000 then 'Greensboro'
       when fixture.id <= 4000 then 'Raleigh'
       when fixture.id <= 7000 then 'Paris' else 'Madrid' end,
  case when fixture.id <= 4000 then '27405' else '75001' end
from generate_series(1, 10000) as fixture(id);

insert into public.services (
  tenant_id, title_json, duration_minutes, price, category, currency
)
select
  md5('glow46-bench-tenant-' || fixture.id)::uuid,
  '{"fr":"Tresses","en":"Braids","es":"Trenzas"}'::jsonb,
  60,
  3000 + fixture.id % 500,
  'hair',
  case when fixture.id <= 4000 then 'USD' else 'EUR' end
from generate_series(1, 10000) as fixture(id);

insert into public.salon_public_profiles (
  tenant_id, slug, business_name, country_code, city, postal_code,
  categories, is_published, published_at, map_latitude, map_longitude
)
select
  md5('glow46-bench-tenant-' || fixture.id)::uuid,
  'bench-salon-' || fixture.id,
  case when fixture.id <= 1000 then 'Braids Benchmark ' else 'Benchmark Salon ' end || fixture.id,
  case when fixture.id <= 4000 then 'US' when fixture.id <= 7000 then 'FR' else 'ES' end,
  case when fixture.id <= 1000 then 'Greensboro'
       when fixture.id <= 4000 then 'Raleigh'
       when fixture.id <= 7000 then 'Paris' else 'Madrid' end,
  case when fixture.id <= 4000 then '27405' else '75001' end,
  array['hair'],
  true,
  now(),
  case when fixture.id % 5 = 0 then null
       when fixture.id <= 1000 then 36.05 + (fixture.id % 100) * 0.0002
       when fixture.id <= 4000 then 35.78 + (fixture.id % 100) * 0.0002
       when fixture.id <= 7000 then 48.85 + (fixture.id % 100) * 0.0002
       else 40.41 + (fixture.id % 100) * 0.0002 end,
  case when fixture.id % 5 = 0 then null
       when fixture.id <= 1000 then -79.80 + ((fixture.id / 100) % 100) * 0.0002
       when fixture.id <= 4000 then -78.64 + ((fixture.id / 100) % 100) * 0.0002
       when fixture.id <= 7000 then 2.35 + ((fixture.id / 100) % 100) * 0.0002
       else -3.70 + ((fixture.id / 100) % 100) * 0.0002 end
from generate_series(1, 10000) as fixture(id);

analyze public.tenants;
analyze public.services;
analyze public.salon_public_profiles;

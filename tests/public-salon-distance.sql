-- Synthetic GLOW-46 map pins; loaded only into a disposable local database.
select public.test_assert(
  (select namespace.nspname
   from pg_extension as extension
   join pg_namespace as namespace on namespace.oid = extension.extnamespace
   where extension.extname = 'postgis') = 'extensions',
  'PostGIS lives in the extensions schema'
);
select public.test_assert(
  (select attribute.attgenerated
   from pg_attribute as attribute
   where attribute.attrelid = 'public.salon_public_profiles'::regclass
     and attribute.attname = 'location') = 's',
  'salon location is generated from owner coordinates'
);

insert into auth.users(id, email) values
('20000000-0000-0000-0000-000000000011', 'owner-c@example.invalid'),
('20000000-0000-0000-0000-000000000012', 'owner-d@example.invalid'),
('20000000-0000-0000-0000-000000000013', 'owner-e@example.invalid');
insert into public.tenants(id, name, slug, owner_id, country_code, currency, time_zone) values
('10000000-0000-0000-0000-000000000003', 'Fixture C', 'fixture-c', '20000000-0000-0000-0000-000000000011', 'US', 'USD', 'America/New_York'),
('10000000-0000-0000-0000-000000000004', 'Fixture D', 'fixture-d', '20000000-0000-0000-0000-000000000012', 'US', 'USD', 'America/New_York'),
('10000000-0000-0000-0000-000000000005', 'Fixture E', 'fixture-e', '20000000-0000-0000-0000-000000000013', 'US', 'USD', 'America/New_York');
insert into public.users(id, tenant_id, full_name, email, role) values
('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000003', 'Owner C', 'owner-c@example.invalid', 'owner'),
('20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000004', 'Owner D', 'owner-d@example.invalid', 'owner'),
('20000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000005', 'Owner E', 'owner-e@example.invalid', 'owner');
insert into public.salon_public_profiles(
  tenant_id, slug, business_name, country_code, city, postal_code,
  categories, is_published, published_at, map_latitude, map_longitude
) values
('10000000-0000-0000-0000-000000000003', 'fixture-c-public', 'Fixture C Public', 'US', 'New York', '10003', array['hair'], true, now(), 40.75, -73.99),
('10000000-0000-0000-0000-000000000004', 'fixture-d-public', 'Fixture D Public', 'US', 'New York', '10004', array['hair'], true, now(), 40.80, -73.99),
('10000000-0000-0000-0000-000000000005', 'fixture-e-public', 'Fixture E Public', 'US', 'Albany', '12201', array['hair'], true, now(), null, null);

-- An owner can set or clear only their own pin; partial and invalid pins fail.
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
with changed as (
  update public.salon_public_profiles
  set map_latitude = 40.76, map_longitude = -73.99
  where tenant_id = '10000000-0000-0000-0000-000000000001'
  returning tenant_id
)
select public.test_assert((select count(*) from changed) = 1, 'owner sets own map pin');
select public.test_assert(
  (select extensions.st_y(location::extensions.geometry)
   from public.salon_public_profiles
   where tenant_id = '10000000-0000-0000-0000-000000000001') = 40.76,
  'generated point uses latitude as Y'
);
with changed as (
  update public.salon_public_profiles
  set map_latitude = 40.76, map_longitude = -73.98
  where tenant_id = '10000000-0000-0000-0000-000000000003'
  returning tenant_id
)
select public.test_assert((select count(*) from changed) = 0, 'owner cannot change a foreign public pin');
select public.test_rejected(
  'update public.salon_public_profiles set map_longitude = null where tenant_id = ''10000000-0000-0000-0000-000000000001''',
  '23514'
);
select public.test_rejected(
  'update public.salon_public_profiles set map_latitude = 91 where tenant_id = ''10000000-0000-0000-0000-000000000001''',
  '23514'
);
select public.test_rejected(
  'update public.salon_public_profiles set map_longitude = ''NaN''::double precision where tenant_id = ''10000000-0000-0000-0000-000000000001''',
  '23514'
);
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000002';
with changed as (
  update public.salon_public_profiles set map_latitude = 40.77
  where tenant_id = '10000000-0000-0000-0000-000000000001'
  returning tenant_id
)
select public.test_assert((select count(*) from changed) = 0, 'staff cannot change owner pin');
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000003';
update public.salon_public_profiles
set map_latitude = 40.75, map_longitude = -73.99
where tenant_id = '10000000-0000-0000-0000-000000000002';
reset role;
reset request.jwt.claim.sub;

set role anon;
select public.test_assert(
  has_function_privilege('anon',
    'public.search_public_salons_by_distance(double precision,double precision,text,text,text,text,text,integer,timestamptz,integer,integer)',
    'execute'),
  'anonymous visitors can call only the public distance RPC'
);
select public.test_denied('select map_latitude from public.salon_public_profiles');
select public.test_denied('select map_longitude from public.salon_public_profiles');
select public.test_denied('update public.salon_public_profiles set map_latitude = 40.70');
select public.test_assert(
  (select count(*) from public.salon_public_profiles where location is not null) = 3,
  'anonymous direct pin access remains limited to published salons by RLS'
);
select public.test_assert(
  (select array_agg(result.slug order by result.ordinality)
   from public.search_public_salons_by_distance(40.75, -73.99)
     with ordinality as result)
    = array['fixture-c-public', 'fixture-a-public', 'fixture-d-public', 'fixture-e-public'],
  'distance sort puts nearest pinned salons first and unpinned salon last'
);
select public.test_assert(
  (select slug from public.search_public_salons_by_distance(40.75, -73.99, page_size => 1, page_offset => 1))
    = 'fixture-a-public',
  'distance order is applied before pagination'
);
select public.test_assert(
  (select total_count from public.search_public_salons_by_distance(40.75, -73.99, page_size => 1)) = 4,
  'distance search returns the full matching count'
);
select public.test_assert(
  (select distance_meters from public.search_public_salons_by_distance(40.75, -73.99, page_size => 1)) = 0,
  'distance field uses the same operator as sort'
);
select public.test_assert(
  (select distance_meters is null from public.search_public_salons_by_distance(40.75, -73.99, filter_city => 'Albany')),
  'unpinned salon has no fabricated distance'
);
select public.test_assert(
  (select count(*) from public.search_public_salons_by_distance(40.75, -73.99)
   where slug = 'fixture-b-private') = 0,
  'draft salon pin remains hidden from anonymous search'
);
select public.test_assert(
  (select slug from public.search_public_salons_by_distance(40.75, -73.99, page_size => 0)) = 'fixture-c-public',
  'page size lower bound is one'
);
select public.test_assert(
  (select slug from public.search_public_salons_by_distance(40.75, -73.99, page_size => 1, page_offset => -1)) = 'fixture-c-public',
  'negative offset clamps to zero'
);
select public.test_rejected(
  'select count(*) from public.search_public_salons_by_distance(null, -73.99)', '22023'
);
select public.test_rejected(
  'select count(*) from public.search_public_salons_by_distance(91, -73.99)', '22023'
);
select public.test_rejected(
  'select count(*) from public.search_public_salons_by_distance(40.75, -181)', '22023'
);
select public.test_rejected(
  'select count(*) from public.search_public_salons_by_distance(''NaN''::double precision, -73.99)', '22023'
);
select public.test_rejected(
  'select count(*) from public.search_public_salons_by_distance(''Infinity''::double precision, -73.99)', '22023'
);
reset role;

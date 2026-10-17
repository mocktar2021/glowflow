-- Run only in the disposable database seeded by distance-seed.sql.
set jit = off;
load 'auto_explain';
set role anon;

select current_setting('server_version') as postgres_version,
       current_setting('jit') as effective_jit;
select count(*) as visible_published_salons from public.salon_public_profiles;

explain (analyze, buffers, settings)
select * from public.search_public_salons_by_distance(
  36.05, -79.80,
  search_text => 'braids', filter_country_code => 'US',
  filter_city => 'Greensboro', filter_category => 'hair',
  page_size => 12, page_offset => 0
);
explain (analyze, buffers, settings)
select * from public.search_public_salons_by_distance(
  36.05, -79.80,
  search_text => 'braids', filter_country_code => 'US',
  filter_city => 'Greensboro', filter_category => 'hair',
  page_size => 12, page_offset => 900
);
explain (analyze, buffers, settings)
select * from public.search_public_salons_by_distance(
  36.05, -79.80, page_size => 12, page_offset => 0
);

-- EXPLAIN on an SQL function normally reports only Function Scan. This
-- session-local module logs the filtered query's nested plan as well.
reset role;
set client_min_messages = log;
set auto_explain.log_min_duration = 0;
set auto_explain.log_analyze = on;
set auto_explain.log_buffers = on;
set auto_explain.log_nested_statements = on;
set role anon;
select count(*) from public.search_public_salons_by_distance(
  36.05, -79.80,
  search_text => 'braids', filter_country_code => 'US',
  filter_city => 'Greensboro', filter_category => 'hair',
  page_size => 12, page_offset => 0
);
reset role;
reset auto_explain.log_min_duration;

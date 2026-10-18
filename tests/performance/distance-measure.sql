-- Run only in the disposable database seeded by distance-seed.sql.
-- Measures server-side RPC execution, excluding HTTP and client connection time.
\if :{?bench_jit}
set jit = :bench_jit;
\endif
set role anon;

do $$
declare
  scenario text;
  offset_value integer;
  sample_number integer;
  started_at timestamptz;
  samples double precision[];
  p50 double precision;
  p95 double precision;
  average_ms double precision;
begin
  foreach scenario in array array['filtered_1k', 'global_10k'] loop
    foreach offset_value in array array[0, 900] loop
      samples := array[]::double precision[];
      for sample_number in 1..60 loop
        started_at := clock_timestamp();
        if scenario = 'filtered_1k' then
          perform count(*)
          from public.search_public_salons_by_distance(
            36.05, -79.80,
            search_text => 'braids',
            filter_country_code => 'US',
            filter_city => 'Greensboro',
            filter_category => 'hair',
            page_size => 12,
            page_offset => offset_value
          );
        else
          perform count(*)
          from public.search_public_salons_by_distance(
            36.05, -79.80,
            page_size => 12,
            page_offset => offset_value
          );
        end if;
        if sample_number > 10 then
          samples := array_append(
            samples,
            extract(epoch from clock_timestamp() - started_at) * 1000
          );
        end if;
      end loop;
      select percentile_cont(0.5) within group (order by sample_ms),
             percentile_cont(0.95) within group (order by sample_ms),
             avg(sample_ms)
      into p50, p95, average_ms
      from unnest(samples) as sample(sample_ms);
      raise notice 'scenario %, offset %, samples 50, p50 % ms, p95 % ms, mean % ms',
        scenario,
        offset_value,
        round(p50::numeric, 3),
        round(p95::numeric, 3),
        round(average_ms::numeric, 3);
    end loop;
  end loop;
end;
$$;

reset role;

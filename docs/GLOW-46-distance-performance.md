# GLOW-46 distance search: local performance evidence

## Decision

No SQL or index change is justified by this benchmark. On this local, warm-cache
PostgreSQL 17 test, the existing anonymous distance RPC stayed below the
250 ms p95 target at both page offsets, including an unfiltered 10,000-match
stress case. This is not a production performance sign-off. GLOW-46 remains In
Progress until the same gate is checked on production-equivalent hardware and
realistic data distribution. No hosted database was queried or modified for
this benchmark.

## Reproduction and fixture

Run `bash tests/performance/run-distance.sh` from this repository with Docker
available. The script starts a disposable, unexposed container, builds a new
database from `supabase/schema.sql` plus all ordered migrations, inserts only
synthetic records, and removes the container on exit. Its Docker image is pinned
to `postgis/postgis@sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6`.
The fixture creates 10,000 published, booking-enabled salons, one active hair
service each, and `@example.invalid` users. The first 1,000 salons are named
"Braids Benchmark" in Greensboro, US, so text, country, city, and category
filters match exactly 1,000. The other 9,000 are spread across Raleigh, Paris,
and Madrid. Eighty percent have generated map pins; 20 percent are unpinned.
All identifiers and coordinates are deterministic synthetic values. There are
no production records, credentials, HTTP calls, or geocoding requests.

`distance-measure.sql` makes 10 warm-up calls followed by 50 measured calls
for each scenario and offset, as the `anon` role. Each call consumes all 12
returned rows and is timed inside PostgreSQL with `clock_timestamp()`. Results
are server-side execution latencies, not browser or HTTP end-to-end latency.
`distance-explain.sql` records outer `EXPLAIN (ANALYZE, BUFFERS, SETTINGS)` and
uses local session `auto_explain` to expose the SQL function's nested plan.

## Results, 2026-10-17

The clean-run host exposed 5 x86_64 CPUs and 17 GiB RAM to Docker. The image
reported PostgreSQL 17.5 and PostGIS 3.5.2. The script set `jit = off` for both
measurement and plans. Live GlowFlow PostgreSQL 17.6 reports `jit = off` from
its configuration file, not from a session or function override. A previous
local JIT-on run was therefore a lab artifact, not evidence of production risk.

| Query | Offset | p50 | p95 | Mean |
| --- | ---: | ---: | ---: | ---: |
| 1,000 filtered matches | 0 | 28.355 ms | 38.805 ms | 29.908 ms |
| 1,000 filtered matches | 900 | 30.666 ms | 40.346 ms | 31.355 ms |
| 10,000 unfiltered matches | 0 | 90.338 ms | 117.590 ms | 95.698 ms |
| 10,000 unfiltered matches | 900 | 100.698 ms | 153.627 ms | 106.706 ms |

In an earlier clean fixture load on the same host, the respective p95s were
58.080, 53.892, 175.919, and 170.020 ms. This illustrates run-to-run
variation and still does not establish a hosted production p95.

Representative outer plans returned 12 rows with `Function Scan` execution
times of 42.840 ms and 22.883 ms for the filtered first and later pages,
respectively, and 104.405 ms for the unfiltered first page. Shared hits were
31,339, 30,229, and 140,694, respectively. These are individual samples, not
the p95s above. The nested filtered plan contained a `WindowAgg` over all
1,000 matches for `total_count`, followed by a top-N sort on distance, name,
and slug. It used `salon_public_profiles_market_city_idx` for the filtered
profile scan and repeated RLS/service subplans. It did not use the partial
`salon_public_profiles_published_location_idx` GiST index. The query must
count every matching salon and preserve deterministic tie breaks before
returning a page, so this plan is not index-backed nearest-neighbor pagination.
The GiST remains a spatial access path for future radius or simpler KNN work.

The benchmark has a warm cache, a synthetic uniform distribution, one service
per salon, and no concurrent production traffic. Its container, CPU allocation,
PostgreSQL 17.5, and PostGIS 3.5.2 differ from GlowFlow's hosted hardware,
PostgreSQL 17.6, and PostGIS 3.3.7. Its 50 server-side samples do not include
network or API gateway latency. Run the documented production-equivalent
performance gate before closing GLOW-46. If p95 exceeds 250 ms there, review
RLS/service subplans and counting/pagination together, then retest with the
same public RPC contract and visibility rules.

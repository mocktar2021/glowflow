# GLOW-46 distance sorting rollout

## Scope and contract

`20261017230138_add_public_salon_distance_sorting.sql` adds optional owner-managed
`map_latitude` and `map_longitude` to `salon_public_profiles`. They must be both
blank or both valid WGS84 coordinates. A stored, generated
`location extensions.geography(Point,4326)` and a partial GiST index support
spatial access. Existing rows remain unpinned; there is no geocoder or backfill.
The migration installs PostGIS in `extensions` if absent, and stops if it is
already installed in a different schema. Existing search RPCs remain unchanged.

The new `search_public_salons_by_distance(origin_lat, origin_lon, ...)` RPC uses
the same public filters and 48-row page cap as `search_public_salons_sorted`.
Its first 13 return fields are identical; the final `distance_meters` field is
nullable. Only a valid, explicitly supplied visitor origin activates this RPC.
Pinned salons sort first by spherical distance, then business name and slug;
unpinned salons sort last with `distance_meters = null`. The database rejects
null, out-of-range, NaN, and infinity origins with SQLSTATE `22023`.

The RPC is `SECURITY INVOKER`. Existing RLS restricts anonymous results to
owner-published salons in active markets with booking enabled. Anonymous direct
SELECT is granted only on the generated `location` column, not on the new
latitude/longitude input columns. This is necessary for an invoker RPC to read
pins. A published pin can therefore be queried directly as geography, even
though the RPC never returns raw coordinates. Owners should pin only public
business locations, not private residences or a visitor's live position.
Visitor origins are request parameters, never persisted by this migration.

## Production preflight and apply

This PR does not run SQL against production. Applying it later requires separate
product-owner approval. The only intended target is Supabase organization
`goutxcrujaxjjssbjfsn`, project `rfwhqutkiztxkagbhevp` (GlowFlow). Do not
touch MowFlow. Do not use `supabase db push`, replay the baseline, or apply any
other pending migration as part of this operation.

Before applying, confirm the reviewed merged commit and normalized SQL SHA-256
`e89975924ef4381c121d8a4781902942d2ba20f804fe2ce087c208123d1faa7d`.
Require exactly 34 existing remote migration rows matching the first 34 entries
of `supabase/migration-history-map.json`, ending with
`20261017220612_add_public_salon_sorting`. Confirm PostGIS version 3.3.7 is
available but not installed, the new coordinate columns and index are absent,
and `search_public_salons_by_distance` is absent. Confirm existing relevance
and sorted RPCs retain their reviewed definitions. Stop if any identity,
history, fingerprint, extension, schema, or function observation differs.

Apply only `supabase/migrations/20261017230138_add_public_salon_distance_sorting.sql`
once through the reviewed Supabase migration operation. Record the new remote
history row. If that operation assigns a generated version, verify exactly one
new row named `add_public_salon_distance_sorting`, then reconcile migration
metadata only so the final remote version is `20261017230138`, with no alias
left. Never rerun the SQL to repair a history discrepancy.

After application, verify PostGIS is in `extensions`, columns and generated
point match the reviewed definition, and only the intended function/role grants
were added. Test anonymous ordering and null distance, invalid origins, draft
exclusion, and owner/staff/cross-tenant writes using synthetic fixtures where
safe. Check the old relevance and sorted RPCs still work. Deploy the UI after
the database is ready, or use the UI's explicit compatibility fallback while
the migration is pending. No live owner or visitor coordinates are required to
prove the migration itself.

## Performance gate

Local PostgreSQL 16/PostGIS 3.4 testing confirmed the GiST index can support a
simple nearest-neighbor `ORDER BY location <-> origin LIMIT` query. However,
`EXPLAIN` of this RPC's filtered query with `count(*) over()` and deterministic
tie breaks used a full matching-row sort, not the GiST KNN path, even with
sequential scans disabled. A separate-count CTE rewrite was also measured and
still sorted. Do not describe this RPC as index-backed pagination. The index is
retained as a conventional spatial access path for future radius/KNN work.

Before calling distance sorting production-ready at scale, benchmark the
anonymous RPC on production-equivalent hardware with representative country,
city, service, and text filters across at least 10,000 published salons and
1,000 matching one query. Record `EXPLAIN (ANALYZE, BUFFERS)` and p95 latency;
target p95 at or below 250 ms for page one and a later page. If it misses,
optimize counting/pagination and retest before marking GLOW-46 complete. This
gate has not yet been run.

## Operational rollback

If the distance RPC fails, switch the app to its existing relevance/manual
location fallback. With separate approval, apply only
`supabase/rollbacks/20261017230138_drop_public_salon_distance_sorting.sql` after
the app no longer calls the RPC. It drops that function only. Owner map pins,
the generated point, index, and PostGIS extension remain to avoid deleting
location data or breaking future extension dependents. Verify the existing
search RPCs still work. Leave the forward migration recorded as applied in
history; this is an operational function rollback, not a schema reset. Restoring
distance search later requires a new reviewed migration, not replaying this one.
A later data-removal migration would require a separate explicit decision.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20261017230138_add_public_salon_distance_sorting.sql", import.meta.url), "utf8");
const rollback = await readFile(new URL("../supabase/rollbacks/20261017230138_drop_public_salon_distance_sorting.sql", import.meta.url), "utf8");

test("optional map pin is owner-editable, bounded, generated, and spatially indexed", () => {
  assert.match(migration, /create extension if not exists postgis with schema extensions/);
  assert.match(migration, /add column map_latitude double precision/);
  assert.match(migration, /add column map_longitude double precision/);
  assert.match(migration, /add column location extensions\.geography\(Point, 4326\)[\s\S]*generated always as/);
  assert.match(migration, /map_latitude is null and map_longitude is null/);
  assert.match(migration, /map_latitude is not null\s+and map_longitude is not null/);
  assert.match(migration, /map_latitude between -90 and 90/);
  assert.match(migration, /map_longitude between -180 and 180/);
  assert.match(migration, /using gist \(location\)\s+where is_published = true and location is not null/);
  assert.match(migration, /grant select \(location\) on public\.salon_public_profiles to anon/);
  assert.doesNotMatch(migration, /grant select \([^)]*map_latitude|grant select \([^)]*map_longitude/);
});

test("distance RPC validates origin and preserves the public result boundary", () => {
  assert.match(migration, /create function public\.search_public_salons_by_distance\(\s*origin_lat double precision,\s*origin_lon double precision/);
  assert.match(migration, /distance_meters double precision\s*\)\s*language plpgsql\s*stable\s*security invoker/);
  assert.match(migration, /raise exception 'invalid_origin_coordinates' using errcode = '22023'/);
  assert.match(migration, /profile\.is_published = true/);
  assert.match(migration, /market\.status = 'active'/);
  assert.match(migration, /service\.is_active = true/);
  assert.match(migration, /profile\.location operator\(extensions\.<->\) origin_point as distance_meters/);
  assert.match(migration, /matching\.distance_meters asc nulls last,\s*matching\.business_name,\s*matching\.slug/);
  assert.match(migration, /limit least\(greatest\(coalesce\(page_size, 12\), 1\), 48\)/);
  assert.match(migration, /to anon, authenticated/);
  assert.doesNotMatch(migration, /security definer/);
  assert.doesNotMatch(migration, /create or replace function public\.search_public_salons_sorted/);
});

test("operational rollback removes only the distance RPC", () => {
  assert.match(rollback, /drop function if exists public\.search_public_salons_by_distance\(/);
  assert.doesNotMatch(rollback, /drop table|drop extension|drop column|drop index|search_public_salons_sorted\(/);
});

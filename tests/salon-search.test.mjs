import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260905014500_add_public_salon_search.sql",
);

test("keeps public discovery separate and protected by RLS", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /create table public\.salon_public_profiles/);
  assert.match(sql, /alter table public\.salon_public_profiles enable row level security/);
  assert.match(sql, /salon_public_profiles_public_select/);
  assert.match(sql, /is_published = true/);
  assert.match(sql, /markets\.status = 'active'/);
  assert.match(sql, /users\.id = \(select auth\.uid\(\)\)/);
});

test("uses indexed full-text and filterable search", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /using gin \(search_vector\)/);
  assert.match(sql, /services_public_title_search_idx/);
  assert.match(sql, /create function public\.search_public_salons/);
  assert.match(sql, /websearch_to_tsquery\('simple'/);
  assert.match(sql, /filter_country_code/);
  assert.match(sql, /filter_city/);
  assert.match(sql, /filter_postal_code/);
  assert.match(sql, /filter_category/);
  assert.match(sql, /maximum_price/);
  assert.match(sql, /available_before/);
  assert.match(sql, /count\(\*\) over\(\)/);
  assert.match(sql, /limit least\(greatest\(page_size, 1\), 48\)/);
});

test("returns an explicit public search field set", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const signature = sql.slice(
    sql.indexOf("returns table ("),
    sql.indexOf("language sql"),
  );

  assert.match(signature, /business_name text/);
  assert.match(signature, /description_json jsonb/);
  assert.match(signature, /starting_price integer/);
  assert.match(signature, /currency text/);
  assert.doesNotMatch(signature, /owner_id/);
  assert.doesNotMatch(signature, /email/);
  assert.doesNotMatch(signature, /phone/);
});

// Fresh-install compatibility is executed against PostgreSQL in schema-database.test.mjs.

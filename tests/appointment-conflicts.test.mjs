import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = await readFile(
  path.join(root, "supabase/migrations/20260905191500_add_appointment_conflict_guards.sql"),
  "utf8",
);
const messages = await readFile(path.join(root, "lib/bookings/conflicts.ts"), "utf8");
const extensionMigration = await readFile(
  path.join(root, "supabase/migrations/20260905193000_move_btree_gist_to_extensions.sql"),
  "utf8",
);


test("derives appointment timing from the selected service", () => {
  assert.match(migration, /set_appointment_service_timing/);
  assert.match(migration, /service\.duration_minutes/);
  assert.match(migration, /service\.sanitation_buffer_minutes/);
  assert.match(migration, /new\.end_time := new\.start_time/);
  assert.match(migration, /new\.buffer_end_time := new\.end_time/);
});

test("prevents concurrent staff and station overlaps", () => {
  assert.match(migration, /create extension if not exists btree_gist/);
  assert.match(migration, /appointments_staff_no_overlap/);
  assert.match(migration, /appointments_station_no_overlap/);
  assert.match(migration, /tstzrange\(start_time, buffer_end_time, '\[\)'\) with &&/);
  assert.match(migration, /where \(status = 'confirmed'\)/);
  assert.match(migration, /station_name is not null/);
});

test("releases canceled appointments and allows adjacent slots", () => {
  assert.match(migration, /'\[\)'/);
  assert.doesNotMatch(migration, /status in \('confirmed', 'canceled'\)/);
});

test("maps database conflicts to every supported locale", () => {
  assert.match(messages, /error\.code === "23P01"/);
  assert.match(messages, /appointments_staff_no_overlap/);
  assert.match(messages, /appointments_station_no_overlap/);
  assert.match(messages, /fr:/);
  assert.match(messages, /en:/);
  assert.match(messages, /es:/);
});

test("keeps btree_gist outside the exposed public schema", () => {
  assert.match(extensionMigration, /create schema if not exists extensions/);
  assert.match(extensionMigration, /alter extension btree_gist set schema extensions/);
});

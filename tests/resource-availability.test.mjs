import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = await readFile(
  path.join(root, "supabase/migrations/20260905200056_add_resource_availability.sql"),
  "utf8",
);
const page = await readFile(path.join(root, "app/[locale]/dashboard/availability/page.tsx"), "utf8");
const actions = await readFile(path.join(root, "app/[locale]/dashboard/availability/actions.ts"), "utf8");

test("stores tenant-scoped staff, exception, and station schedules", () => {
  assert.match(migration, /create table public\.staff_working_hours/);
  assert.match(migration, /create table public\.staff_schedule_exceptions/);
  assert.match(migration, /create table public\.station_working_hours/);
  assert.match(migration, /foreign key \(staff_id, tenant_id\)/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /private\.is_tenant_owner/);
  assert.match(migration, /private\.is_tenant_member/);
});

test("evaluates availability in the salon time zone", () => {
  assert.match(migration, /requested_start at time zone target_time_zone/);
  assert.match(migration, /requested_end at time zone target_time_zone/);
  assert.match(migration, /extract\(dow from local_start\)/);
  assert.match(migration, /staff_working_hours/);
  assert.match(migration, /station_working_hours/);
  assert.match(migration, /staff_schedule_exceptions/);
  assert.match(migration, /appointment\.buffer_end_time/);
});

test("converts local exceptions through the tenant time zone", () => {
  assert.match(migration, /local_start at time zone target_time_zone/);
  assert.match(migration, /local_end at time zone target_time_zone/);
  assert.match(actions, /create_staff_schedule_exception/);
  assert.match(actions, /local_start: parsed\.data\.localStart/);
});

test("renders owner controls in French, English, and Spanish", () => {
  assert.match(page, /Disponibilités/);
  assert.match(page, /Availability/);
  assert.match(page, /Disponibilidad/);
  assert.match(page, /name="is_enabled"/);
  assert.match(page, /type="datetime-local"/);
  assert.match(page, /tenant\?\.time_zone/);
});

test("covers America New York daylight-saving boundaries", () => {
  const parts = (iso) => new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));

  assert.equal(parts("2026-03-08T06:30:00Z"), "01:30");
  assert.equal(parts("2026-03-08T07:30:00Z"), "03:30");
  assert.equal(parts("2026-11-01T05:30:00Z"), "01:30");
  assert.equal(parts("2026-11-01T06:30:00Z"), "01:30");
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = await readFile(
  path.join(root, "supabase/migrations/20260905201500_add_calendar_appointment_actions.sql"),
  "utf8",
);
const stationHoursMigration = await readFile(
  path.join(root, "supabase/migrations/20260905210500_fix_station_hours_fallback.sql"),
  "utf8",
);
const page = await readFile(path.join(root, "app/[locale]/dashboard/calendar/page.tsx"), "utf8");
const actions = await readFile(path.join(root, "app/[locale]/dashboard/calendar/actions.ts"), "utf8");
const dateTimeFields = await readFile(path.join(root, "app/[locale]/dashboard/calendar/date-time-fields.tsx"), "utf8");
const dashboard = await readFile(path.join(root, "app/[locale]/dashboard/page.tsx"), "utf8");

test("creates appointments idempotently in the salon time zone", () => {
  assert.match(migration, /calendar_request_key uuid/);
  assert.match(migration, /unique index[\s\S]*tenant_id, calendar_request_key/);
  assert.match(migration, /local_start at time zone target_time_zone/);
  assert.match(migration, /create_calendar_appointment/);
  assert.match(migration, /existing_id is not null then return existing_id/);
});

test("enforces schedules and authoritative overlap protection", () => {
  assert.match(migration, /public\.is_resource_available/);
  assert.match(migration, /errcode = '23P01'/);
  assert.match(migration, /status = 'canceled'/);
  assert.match(migration, /set start_time = requested_start, status = 'confirmed'/);
  assert.match(actions, /isAppointmentConflict/);
});

test("falls back to staff hours until station hours are configured", () => {
  assert.match(stationHoursMigration, /configured_hours/);
  assert.match(stationHoursMigration, /and exists \([\s\S]*station_working_hours as configured_hours/);
  assert.match(stationHoursMigration, /and not exists \([\s\S]*station_working_hours as hours/);
  assert.match(stationHoursMigration, /security invoker/);
  assert.match(stationHoursMigration, /to authenticated/);
});

test("keeps calendar mutations tenant scoped and authenticated", () => {
  assert.match(migration, /private\.is_tenant_member/);
  assert.match(migration, /security invoker/g);
  assert.match(migration, /revoke all[\s\S]*from public, anon/g);
  assert.match(migration, /to authenticated/g);
  assert.match(actions, /\["owner", "staff"\]/);
  assert.match(actions, /tenant_id: tenantId/);
});

test("renders daily and weekly touch friendly calendar controls in three languages", () => {
  assert.match(page, /Calendrier/);
  assert.match(page, /Calendar/);
  assert.match(page, /Calendario/);
  assert.match(page, /\["day", "week"\]/);
  assert.match(page, /CalendarDateTimeFields/);
  assert.match(page, /labels\.selectDate/);
  assert.match(dateTimeFields, /type="date"/);
  assert.match(dateTimeFields, /type="time"/);
  assert.match(dateTimeFields, /name="local_start"/);
  assert.match(dateTimeFields, /\$\{date\}T\$\{time\}/);
  assert.doesNotMatch(page, /type="datetime-local"/);
  assert.match(page, /deposit_paid/);
  assert.match(page, /createQuickClient/);
  assert.match(dashboard, /dashboard\/calendar/);
});

test("uses stable local date keys across daylight saving transitions", () => {
  const key = (iso) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(iso));
    const value = (type) => parts.find((item) => item.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  };

  assert.equal(key("2026-03-08T06:30:00Z"), "2026-03-08");
  assert.equal(key("2026-03-08T07:30:00Z"), "2026-03-08");
  assert.equal(key("2026-11-01T05:30:00Z"), "2026-11-01");
  assert.equal(key("2026-11-01T06:30:00Z"), "2026-11-01");
});

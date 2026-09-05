import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = await readFile(
  path.join(root, "supabase/migrations/20260905231500_add_public_availability_booking.sql"),
  "utf8",
);
const route = await readFile(path.join(root, "app/api/public-booking/route.ts"), "utf8");
const page = await readFile(path.join(root, "app/[locale]/book/[slug]/page.tsx"), "utf8");
const flow = await readFile(path.join(root, "components/glowflow/live-booking-flow.tsx"), "utf8");

test("public booking rechecks availability and stores client locale", () => {
  assert.match(migration, /private\.public_resource_available/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /appointments_public_booking_request_key_idx/);
  assert.match(migration, /public_time_unavailable/);
  assert.match(migration, /preferred_locale/);
  assert.match(migration, /booking_locale/);
  assert.match(migration, /insert into public\.appointments/);
});

test("public booking functions expose only controlled entry points", () => {
  assert.match(migration, /security definer/g);
  assert.match(migration, /set search_path = ''/g);
  assert.match(migration, /revoke all on function public\.create_public_appointment/);
  assert.match(migration, /grant execute on function public\.create_public_appointment[\s\S]*to anon, authenticated/);
});

test("booking route validates requests and reports slot conflicts", () => {
  assert.match(route, /bookingSchema/);
  assert.match(route, /create_public_appointment/);
  assert.match(route, /slot_unavailable/);
  assert.match(route, /cache-control.*private, no-store/);
});

test("booking page and flow show confirmation from stored appointment data", () => {
  assert.match(page, /LiveBookingFlow/);
  assert.match(page, /\.eq\("is_active", true\)/);
  assert.match(flow, /\/api\/public-booking/);
  assert.match(flow, /confirmation\.appointment_id/);
  assert.match(flow, /fr:[\s\S]*en:[\s\S]*es:/);
});

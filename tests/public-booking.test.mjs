import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = await readFile(
  path.join(root, "supabase/migrations/20260905234045_add_public_availability_booking.sql"),
  "utf8",
);
const rpcPermissions = await readFile(
  path.join(root, "supabase/migrations/20260905234226_restrict_public_booking_rpcs.sql"),
  "utf8",
);
const route = await readFile(path.join(root, "app/api/public-booking/route.ts"), "utf8");
const page = await readFile(path.join(root, "app/[locale]/book/[slug]/page.tsx"), "utf8");
const flow = await readFile(path.join(root, "components/glowflow/live-booking-flow.tsx"), "utf8");
const staffEligibility = await readFile(path.join(root, "supabase/migrations/20261015004638_enforce_public_service_staff_eligibility.sql"), "utf8");
const staffEligibilityRollback = await readFile(path.join(root, "supabase/rollbacks/20261015004638_restore_unrestricted_public_service_staff.sql"), "utf8");
const publicationGuard = await readFile(
  path.join(root, "supabase/migrations/20260925184222_require_published_salon_for_public_booking.sql"),
  "utf8",
);
const messages = await readFile(path.join(root, "lib/i18n.ts"), "utf8");

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

test("keeps public booking RPCs behind the server boundary", () => {
  assert.match(rpcPermissions, /from public, anon, authenticated/);
  assert.match(rpcPermissions, /to service_role/g);
  assert.doesNotMatch(rpcPermissions, /to anon/);
});

test("public availability and booking honor optional service staff assignments", () => {
  assert.match(staffEligibility, /not exists \([\s\S]+from public\.service_staff as configured_staff/);
  assert.match(staffEligibility, /eligible_staff\.staff_id = hours\.staff_id/);
  assert.match(staffEligibility, /eligible_staff\.staff_id = target_staff_id/);
  assert.match(staffEligibility, /public_staff_not_eligible/);
  assert.match(staffEligibility, /grant execute on function public\.create_public_appointment[\s\S]*to service_role/);
  assert.doesNotMatch(staffEligibility, /to anon, authenticated/);
  assert.doesNotMatch(staffEligibilityRollback, /public_staff_not_eligible/);
});

test("requires owner publication for public slots and appointment creation", () => {
  assert.equal((publicationGuard.match(/from public\.salon_public_profiles as profile/g) ?? []).length, 2);
  assert.equal((publicationGuard.match(/profile\.is_published = true/g) ?? []).length, 2);
  assert.match(publicationGuard, /grant execute on function public\.get_public_booking_slots[\s\S]*to service_role/);
  assert.doesNotMatch(publicationGuard, /to anon, authenticated/);
  assert.match(page, /from\("salon_public_profiles"\)[\s\S]*\.eq\("is_published", true\)[\s\S]*if \(!publishedProfile\) notFound\(\)/);
});

test("uses neutral localized cancellation guidance without inventing a deadline", () => {
  assert.match(messages, /Consultez la politique du salon avant de confirmer/);
  assert.match(messages, /Review the salon policy before confirming/);
  assert.match(messages, /Consulta la política del salón antes de confirmar/);
  assert.doesNotMatch(messages, /Annulation gratuite|Free cancellation|Cancelación gratuita|24 hours|24 h|24 horas/);
});

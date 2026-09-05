import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = await readFile(path.join(root, "supabase/migrations/20260905170000_add_service_catalog_management.sql"), "utf8");
const page = await readFile(path.join(root, "app/[locale]/dashboard/services/page.tsx"), "utf8");
const actions = await readFile(path.join(root, "app/[locale]/dashboard/services/actions.ts"), "utf8");
const dashboard = await readFile(path.join(root, "app/[locale]/dashboard/page.tsx"), "utf8");
const checkout = await readFile(path.join(root, "app/api/checkout/route.ts"), "utf8");

test("stores service currency and tenant-scoped eligible staff", () => {
  assert.match(migration, /add column if not exists currency text/);
  assert.match(migration, /create table if not exists public\.service_staff/);
  assert.match(migration, /foreign key \(service_id, tenant_id\)/);
  assert.match(migration, /foreign key \(staff_id, tenant_id\)/);
});

test("limits service catalog writes to tenant owners", () => {
  assert.match(migration, /services_owner_insert/);
  assert.match(migration, /services_owner_update/);
  assert.match(migration, /services_owner_delete/);
  assert.match(migration, /private\.is_tenant_owner/);
  assert.match(page, /owner\.role !== "owner"/);
  assert.match(actions, /owner\.role !== "owner"/);
});

test("validates trusted service pricing and deposits", () => {
  assert.match(actions, /moneyToMinor/);
  assert.match(actions, /depositAmount > price/);
  assert.match(actions, /currency: tenant\.currency/);
  assert.match(checkout, /\.eq\("is_active", true\)/);
});

test("supports multilingual services and operational timing", () => {
  assert.match(page, /name="title_fr"/);
  assert.match(page, /name="title_en"/);
  assert.match(page, /name="title_es"/);
  assert.match(page, /name="duration_minutes"/);
  assert.match(page, /name="sanitation_buffer_minutes"/);
  assert.match(page, /name="station_name"/);
});

test("archives services without deleting historical records", () => {
  const archiveAction = actions.slice(actions.indexOf("export async function setServiceActive"));
  assert.match(archiveAction, /is_active: active/);
  assert.doesNotMatch(archiveAction, /\.delete\(\)/);
  assert.match(page, /labels\.archived/);
});

test("links the dashboard to the service catalog", () => {
  assert.match(dashboard, /dashboard\/services/);
  assert.match(dashboard, /Service catalog|Prestations|Servicios/);
});

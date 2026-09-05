import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = await readFile(
  path.join(root, "supabase/migrations/20260905222000_add_walk_in_queue.sql"),
  "utf8",
);
const page = await readFile(path.join(root, "app/[locale]/dashboard/walk-ins/page.tsx"), "utf8");
const actions = await readFile(path.join(root, "app/[locale]/dashboard/walk-ins/actions.ts"), "utf8");
const realtime = await readFile(path.join(root, "app/[locale]/dashboard/walk-ins/realtime.tsx"), "utf8");
const dashboard = await readFile(path.join(root, "app/[locale]/dashboard/page.tsx"), "utf8");

test("creates a tenant-scoped queue with reporting history", () => {
  assert.match(migration, /create table public\.walk_in_queue/);
  assert.match(migration, /tenant_id uuid not null references public\.tenants/);
  assert.match(migration, /status in \('waiting', 'ready', 'in_service', 'completed', 'removed'\)/);
  assert.match(migration, /arrived_at timestamptz/);
  assert.match(migration, /completed_at timestamptz/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /private\.is_tenant_member/g);
  assert.match(migration, /revoke all on public\.walk_in_queue from anon/);
});

test("supports queue ordering, assignments, and controlled status changes", () => {
  assert.match(migration, /create or replace function public\.enqueue_walk_in/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /create or replace function public\.move_walk_in/);
  assert.match(migration, /create or replace function public\.assign_walk_in/);
  assert.match(migration, /create or replace function public\.set_walk_in_status/);
  assert.match(migration, /invalid_walk_in_transition/);
  assert.match(actions, /enqueue_walk_in/);
  assert.match(actions, /move_walk_in/);
  assert.match(actions, /assign_walk_in/);
  assert.match(actions, /set_walk_in_status/);
});

test("updates connected tenant devices through Supabase Realtime", () => {
  assert.match(migration, /alter publication supabase_realtime add table public\.walk_in_queue/);
  assert.match(realtime, /postgres_changes/);
  assert.match(realtime, /filter: `tenant_id=eq\.\$\{tenantId\}`/);
  assert.match(realtime, /router\.refresh/);
  assert.match(realtime, /removeChannel/);
});

test("renders touch-friendly queue controls in French, English, and Spanish", () => {
  assert.match(page, /File sans rendez-vous/);
  assert.match(page, /Walk-in queue/);
  assert.match(page, /Cola sin cita/);
  assert.match(page, /addWalkIn/);
  assert.match(page, /moveWalkIn/);
  assert.match(page, /assignWalkIn/);
  assert.match(page, /setWalkInStatus/);
  assert.match(page, /Completed today/);
  assert.match(dashboard, /dashboard\/walk-ins/);
});

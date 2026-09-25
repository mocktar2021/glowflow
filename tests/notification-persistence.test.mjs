import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260925213000_add_notification_persistence.sql", import.meta.url), "utf8");
const rollback = await readFile(new URL("../supabase/rollbacks/20260925213000_drop_empty_notification_persistence.sql", import.meta.url), "utf8");
const page = await readFile(new URL("../app/[locale]/dashboard/notifications/page.tsx", import.meta.url), "utf8");
const runbook = await readFile(new URL("../docs/GLOW-29-messaging-persistence.md", import.meta.url), "utf8");

test("migration keeps notification history tenant-scoped, append-only, and service-owned", () => {
  for (const table of ["client_notification_consent_events", "notification_outbox", "notification_delivery_attempts"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`on public\\.${table} for select to authenticated`));
  }
  assert.match(migration, /notification_history_is_append_only/);
  assert.match(migration, /grant execute on function public\.record_client_notification_consent[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.schedule_appointment_notifications[\s\S]*to service_role/);
  assert.match(migration, /revoke all on function public\.claim_notification_delivery[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /consent_status in \('consented', 'opted_out'\)/);
  assert.match(migration, /appointment_start_time timestamptz not null/);
  assert.match(migration, /on conflict \(tenant_id, appointment_id, notification_kind, channel, appointment_start_time\) do nothing/);
  assert.match(migration, /notification_schedule_request_mismatch/);
  assert.match(migration, /appointment\.start_time = outbox\.appointment_start_time/);
  assert.match(migration, /notification_not_eligible/);
  assert.doesNotMatch(migration, /resend|twilio|sendgrid|messagebird|application_fee/i);
});

test("application is read-only and truthfully labels provider delivery disabled", () => {
  assert.match(page, /get_notification_status_rows/);
  assert.doesNotMatch(page, /\.from\("notification_(?:outbox|delivery_attempts)"\)/);
  assert.doesNotMatch(page, /\.insert\(|\.update\(|\.delete\(/);
  assert.match(runbook, /does not send email or SMS/);
  assert.match(runbook, /retry cadence and maximum attempts/);
});

test("rollback preserves any recorded audit history", () => {
  assert.match(rollback, /notification_history_not_empty_preserve_audit_history/);
  for (const table of ["client_notification_consent_events", "notification_outbox", "notification_delivery_attempts"]) {
    assert.match(rollback, new RegExp(`exists \\(select 1 from public\\.${table}\\)`));
  }
});

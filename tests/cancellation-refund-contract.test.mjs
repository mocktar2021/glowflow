import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("calendar cancellation remains tenant-member scoped and has no financial side effect", async () => {
  const migration = await read("supabase/migrations/20260905203507_add_calendar_appointment_actions.sql");
  const body = migration.match(/create or replace function public\.cancel_calendar_appointment\(target_appointment_id uuid\)([\s\S]*?)\n\$\$;/)?.[1];
  assert.ok(body, "cancellation RPC must be present");
  assert.match(body, /security invoker/i);
  assert.match(body, /status = 'confirmed'/);
  assert.match(body, /private\.is_tenant_member\(tenant_id\)/);
  assert.doesNotMatch(body, /payment_entries|refund|stripe/i,
    "status cancellation must not masquerade as a payment refund");
  assert.match(migration, /revoke all on function public\.cancel_calendar_appointment\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.cancel_calendar_appointment\(uuid\) to authenticated/);
});

test("the staff cancellation action cannot invoke Stripe or create a ledger refund", async () => {
  const action = await read("app/[locale]/dashboard/calendar/actions.ts");
  const body = action.match(/export async function cancelAppointment\([\s\S]*?\n\}/)?.[0];
  assert.ok(body, "cancellation action must be present");
  assert.match(body, /memberContext\(locale, formData\)/);
  assert.match(body, /rpc\("cancel_calendar_appointment"/);
  assert.doesNotMatch(body, /payment_entries|refund|stripe/i);
});

test("sandbox webhook does not mistake a refund event for a settled booking", async () => {
  const source = await read("lib/stripe-deposit-events.ts");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const { sandboxDepositEventArguments } = await import(
    `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
  );
  for (const type of ["charge.refunded", "refund.created", "refund.updated"]) {
    assert.equal(sandboxDepositEventArguments({ type, livemode: false }), null, type);
  }
  const route = await read("app/api/stripe/webhook/route.ts");
  assert.doesNotMatch(route, /refunds\.create|payment_entries/,
    "a webhook acknowledgment is not a reconciled refund ledger entry");
});

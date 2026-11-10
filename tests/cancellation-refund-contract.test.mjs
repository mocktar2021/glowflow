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

test("paid-deposit cancellation warns staff in each locale without promising a refund outcome", async () => {
  const page = await read("app/[locale]/dashboard/calendar/page.tsx");
  for (const message of [
    "Cette action ne rembourse pas l’acompte. Consultez la politique du salon et traitez tout remboursement séparément.",
    "This action does not refund the deposit. Review the salon policy and handle any refund separately.",
    "Esta acción no reembolsa el depósito. Consulta la política del salón y gestiona cualquier reembolso por separado.",
  ]) assert.ok(page.includes(message), `Missing localized refund notice: ${message}`);
  assert.match(page, /appointment\.deposit_paid \? <p role="note"[^>]*>\{labels\.cancelPaidNotice\}<\/p> : null/,
    "the notice must appear beside the cancel action only when a deposit was paid");
});

test("canceled paid-deposit cards keep a factual refund caveat after the cancel action disappears", async () => {
  const page = await read("app/[locale]/dashboard/calendar/page.tsx");
  for (const message of [
    "L’annulation du rendez-vous n’a pas, à elle seule, remboursé l’acompte. Vérifiez tout remboursement séparément.",
    "Canceling the appointment did not itself refund the deposit. Verify any refund separately.",
    "Cancelar la cita no reembolsó por sí solo el depósito. Verifica cualquier reembolso por separado.",
  ]) assert.ok(page.includes(message), `Missing localized canceled-deposit caveat: ${message}`);
  assert.match(page, /appointment\.status === "canceled" && appointment\.deposit_paid \? <p role="note"[^>]*>\{labels\.canceledPaidNotice\}<\/p> : null/);
});

test("calendar deposit labels describe recorded history without implying a debt or refund state", async () => {
  const page = await read("app/[locale]/dashboard/calendar/page.tsx");
  for (const label of [
    "Paiement d’acompte enregistré", "Aucun acompte payé enregistré",
    "Deposit payment recorded", "No paid deposit recorded",
    "Pago de depósito registrado", "No se ha registrado ningún depósito pagado",
  ]) assert.ok(page.includes(label), `Missing factual deposit label: ${label}`);
  assert.match(page, /appointment\.deposit_paid \? labels\.paid : labels\.unpaid/);
  assert.doesNotMatch(page, /paid: "Deposit paid", unpaid: "Deposit unpaid"/);
  assert.doesNotMatch(page, /paid: "Depósito pagado", unpaid: "Depósito pendiente"/);
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

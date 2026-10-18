import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/nails/history.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { lastInfillDate } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const entry = (id, performed_on, service_kind, replaces_record_id = null) =>
  ({ id, performed_on, service_kind, replaces_record_id });

test("last infill comes from the latest effective infill record, not appointment order", () => {
  assert.equal(lastInfillDate({ complete: true, records: [
    entry("a", "2026-03-03", "infill"),
    entry("b", "2026-04-15", "new_set"),
    entry("c", "2026-05-02", "infill"),
  ] }), "2026-05-02");
});

test("corrections replace prior entries without rewriting history", () => {
  assert.equal(lastInfillDate({ complete: true, records: [
    entry("a", "2026-03-03", "infill"),
    entry("b", "2026-05-02", "infill"),
    entry("c", "2026-05-02", "other", "b"),
  ] }), "2026-03-03");
  assert.equal(lastInfillDate({ complete: true, records: [
    entry("a", "2026-03-03", "infill"),
    entry("b", "2026-05-02", "infill"),
    entry("c", "2026-04-20", "infill", "b"),
  ] }), "2026-04-20");
});

test("no infill remains unknown rather than inferred from a booking or preference", () => {
  assert.equal(lastInfillDate({ complete: true, records: [] }), null);
  assert.equal(lastInfillDate({ complete: true, records: [entry("a", "2026-05-02", "new_set")] }), null);
  assert.equal(lastInfillDate({ complete: true, records: [entry("a", "02/05/2026", "infill")] }), null);
});

test("a paginated slice cannot be presented as the client's last infill", () => {
  const firstPage = [entry("a", "2026-05-02", "new_set")];
  assert.throws(() => lastInfillDate({ complete: false, records: firstPage }), /nail_history_incomplete/);
  assert.equal(lastInfillDate({ complete: true, records: [
    ...firstPage,
    entry("b", "2026-03-03", "infill"),
  ] }), "2026-03-03");
});

test("current schema does not yet satisfy the nail-history persistence contract", async () => {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const snapshot = await readFile(new URL("../supabase/migrations/20260925194709_add_trusted_appointment_payment_recording.sql", import.meta.url), "utf8");
  assert.match(schema, /nail_preferences jsonb not null default '\{\}'::jsonb/);
  assert.match(schema, /create policy clients_tenant_select[\s\S]*?private\.is_tenant_member\(tenant_id\)/);
  assert.match(snapshot, /service_title_json = service\.title_json/);
  assert.doesNotMatch(snapshot, /service_category\s*=\s*service\.category/);
});

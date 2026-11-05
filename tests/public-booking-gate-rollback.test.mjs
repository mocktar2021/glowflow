// GLOW-56 guarded rollback drill against a disposable local PostgreSQL database.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const connection = process.env.GLOWFLOW_SANDBOX_TEST_DATABASE_URL;
const psql = process.env.PSQL_BIN || "psql";
const root = new URL("../", import.meta.url);

function sql(input) {
  const result = spawnSync(psql, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", "-d", connection], {
    input, encoding: "utf8", timeout: 90_000,
  });
  if (result.status !== 0) {
    let message = String(result.stderr || "Local PostgreSQL command failed.");
    for (const secret of [connection, connection && new URL(connection).password]) {
      if (secret) message = message.replaceAll(secret, "[redacted]");
    }
    throw new Error(message.slice(0, 2500));
  }
  return result.stdout.trim().split("\n").at(-1);
}

test("GLOW-56 contract gate rollback preserves state and restores dormant v1", {
  skip: !connection, timeout: 120_000,
}, () => {
  const url = new URL(connection);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/glowflow_sandbox_test[0-9_]*$/);
  assert.ok(!url.search && !url.hash);
  assert.equal(sql("select count(*) from pg_tables where schemaname='public'"), "0");

  sql(readFileSync(new URL("tests/supabase-platform-fixture.sql", root), "utf8"));
  sql(readFileSync(new URL("supabase/schema.sql", root), "utf8"));
  for (const name of readdirSync(new URL("supabase/migrations/", root))
    .filter(name => name.endsWith(".sql")).sort()) {
    sql(readFileSync(new URL(`supabase/migrations/${name}`, root), "utf8"));
  }
  sql(readFileSync(new URL("tests/schema-authorization.sql", root), "utf8"));
  const rollback = readFileSync(new URL(
    "supabase/rollbacks/20261105124804_drop_public_booking_contract_gate.sql", root), "utf8");
  assert.equal(sql("select mode from private.public_booking_contract_gate"), "legacy");

  sql(`insert into private.public_booking_intent_policy
    (prepared_ttl,retention_ttl,configured_at)
    values (interval '2 hours',interval '3 days',clock_timestamp())`);
  assert.throws(() => sql(rollback), /booking_contract_rollback_rows_present/);
  assert.equal(sql("select mode from private.public_booking_contract_gate"), "legacy",
    "failed rollback must leave the gate intact");
  sql("delete from private.public_booking_intent_policy");

  sql(rollback);
  assert.equal(sql("select to_regclass('private.public_booking_contract_gate') is null"), "t");
  for (const signature of [
    "create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)",
    "prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)",
    "commit_public_booking_intent(text,text,uuid)",
    "reconcile_public_booking_intent(text,text,uuid)",
    "cancel_public_booking_intent(text,text,uuid)",
    "acknowledge_public_booking_intent(text,text,uuid)",
  ]) {
    assert.equal(sql(`select has_function_privilege('service_role','public.${signature}','execute')`), "t");
  }
  assert.equal(sql("select prosecdef from pg_proc where oid='public.commit_public_booking_intent(text,text,uuid)'::regprocedure"), "f");
  assert.equal(sql("select has_table_privilege('service_role','private.public_booking_intents','insert')"), "t");
  assert.equal(sql("select has_table_privilege('service_role','private.public_booking_browser_sessions','insert')"), "t");
  assert.equal(sql("select has_function_privilege('service_role','private.lock_public_booking_browser_session(uuid,text,boolean,boolean)','execute')"), "t");

  const slots = JSON.parse(sql(`select json_agg(slot_start order by slot_start)
    from public.get_public_booking_slots('fixture-a','40000000-0000-0000-0000-000000000001',
      current_date + (8 - extract(dow from current_date)::integer))
    where staff_id='20000000-0000-0000-0000-000000000002'`));
  assert.ok(slots.length >= 6);
  const appointmentId = sql(`set role service_role;
    select appointment_id from public.create_public_appointment(
      'fixture-a','40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002','${slots[0]}'::timestamptz,
      'Gate Rollback',null,'gate-rollback@example.invalid','en',
      '33333333-3333-4333-8333-333333333333')`);
  assert.match(appointmentId, /^[0-9a-f-]{36}$/);
});

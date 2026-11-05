// GLOW-56 disposable-only prototype test. Not wired into rls-run or CI.
// The SQL under docs/prototypes is NOT a deployable migration.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const connection = process.env.GLOWFLOW_SANDBOX_TEST_DATABASE_URL;
const raceOrder = process.env.GLOWFLOW_GATE_RACE_ORDER || "prepare_first";
const psql = process.env.PSQL_BIN || "psql";
const root = new URL("../", import.meta.url);
const tenant = "10000000-0000-0000-0000-000000000001";
const service = "40000000-0000-0000-0000-000000000001";
const staff = "20000000-0000-0000-0000-000000000002";
const hash = letter => letter.repeat(64);

function safeError(message) {
  let result = String(message || "Local PostgreSQL command failed.");
  for (const secret of [connection, connection && new URL(connection).password]) {
    if (secret) result = result.replaceAll(secret, "[redacted]");
  }
  return new Error(result.slice(0, 2500));
}

function sql(input) {
  const result = spawnSync(psql, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", "-d", connection], {
    input, encoding: "utf8", timeout: 90_000,
  });
  if (result.status !== 0) throw safeError(result.stderr);
  return result.stdout.trim().split("\n").at(-1);
}

function asyncSql(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", "-d", connection], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", value => { stdout += value; });
    child.stderr.setEncoding("utf8").on("data", value => { stderr += value; });
    child.on("error", reject);
    child.on("close", status => status === 0
      ? resolve(stdout.trim().split("\n").at(-1)) : reject(safeError(stderr)));
    child.stdin.end(input);
  });
}

function heldTransaction(input) {
  const child = spawn(psql, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", "-d", connection], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", error => { readyReject(error); reject(error); });
    child.on("close", status => {
      if (!stdout.includes("GATE_HELD")) readyReject(safeError(stderr));
      status === 0 ? resolve(stdout) : reject(safeError(stderr));
    });
  });
  // The ready promise can reject before callers await done; keep that child
  // failure from surfacing as a second, unhandled rejection.
  void done.catch(() => {});
  child.stdout.setEncoding("utf8").on("data", value => {
    stdout += value;
    if (stdout.includes("GATE_HELD")) readyResolve();
  });
  child.stderr.setEncoding("utf8").on("data", value => { stderr += value; });
  const statement = input.trim().endsWith(";") ? input : `${input};`;
  child.stdin.write(`begin;\n${statement}\nselect 'GATE_HELD';\n`);
  return { ready, done, release: () => child.stdin.end("commit;\n") };
}

async function assertTransitionWaits(held, transition) {
  await held.ready;
  const result = asyncSql(`set application_name='glow56_gate_transition'; ${transition}`)
    .then(value => ({ value }), error => ({ error }));
  let sawLockWait = false;
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (sql(`select count(*) from pg_stat_activity
        where application_name='glow56_gate_transition'
          and wait_event_type='Lock'`) === "1") {
        sawLockWait = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(sawLockWait, "transition must visibly wait on the held gate row lock");
  } finally {
    held.release();
    await held.done;
  }
  const outcome = await result;
  if (outcome.error) throw outcome.error;
  return outcome.value;
}

function state(query) { return JSON.parse(sql(query)); }
function asService(query) { return `set role service_role; ${query}`; }
function reconcile(browser, intent = "null") {
  return state(asService(`select public.reconcile_public_booking_intent('fixture-a','${browser}',${intent});`));
}
function prepare(browser, start, generation, email) {
  return asService(`select public.prepare_public_booking_intent(
    'fixture-a','${browser}','${service}','${staff}','${start}'::timestamptz,
    'Gate Fixture',null,'${email}','en','${generation}'::uuid);`);
}

test("GLOW-56 NON-MIGRATION prototype contract gate and service-role bypass fence", {
  skip: !connection, timeout: 180_000,
}, async () => {
  const url = new URL(connection);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/glowflow_sandbox_test[0-9_]*$/);
  assert.ok(!url.search && !url.hash);
  assert.ok(["prepare_first", "transition_first"].includes(raceOrder));
  assert.equal(sql("select count(*) from pg_tables where schemaname='public'"), "0");

  sql(readFileSync(new URL("tests/supabase-platform-fixture.sql", root), "utf8"));
  sql(readFileSync(new URL("supabase/schema.sql", root), "utf8"));
  for (const name of readdirSync(new URL("supabase/migrations/", root))
    .filter(name => name.endsWith(".sql")).sort()) {
    sql(readFileSync(new URL(`supabase/migrations/${name}`, root), "utf8"));
  }
  sql(readFileSync(new URL("tests/schema-authorization.sql", root), "utf8"));
  sql(readFileSync(new URL("docs/prototypes/GLOW-56-booking-contract-gate.sql", root), "utf8"));

  assert.equal(sql("select mode from private.public_booking_contract_gate"), "legacy");
  assert.equal(sql("select relrowsecurity from pg_class where oid='private.public_booking_contract_gate'::regclass"), "t");
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const table of ["public_booking_contract_gate", "public_booking_intents", "public_booking_browser_sessions"]) {
      assert.equal(sql(`select has_table_privilege('${role}','private.${table}','insert')`), "f");
    }
    assert.equal(sql(`select has_function_privilege('${role}',
      'private.lock_public_booking_browser_session(uuid,text,boolean,boolean)','execute')`), "f");
    assert.equal(sql(`select has_function_privilege('${role}',
      'private.create_public_appointment_core(text,uuid,uuid,timestamptz,text,text,text,text,uuid)','execute')`), "f");
    assert.equal(sql(`select has_function_privilege('${role}',
      'private.prepare_public_booking_intent_core(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)','execute')`), "f");
  }
  for (const signature of [
    "create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)",
    "prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)",
    "commit_public_booking_intent(text,text,uuid)",
    "reconcile_public_booking_intent(text,text,uuid)",
    "cancel_public_booking_intent(text,text,uuid)",
    "acknowledge_public_booking_intent(text,text,uuid)",
    "sweep_public_booking_intents(integer)",
  ]) {
    assert.equal(sql(`select has_function_privilege('service_role','public.${signature}','execute')`), "t");
    for (const role of ["anon", "authenticated"]) {
      assert.equal(sql(`select has_function_privilege('${role}','public.${signature}','execute')`), "f");
    }
  }
  assert.throws(() => sql(asService(`insert into private.public_booking_browser_sessions
    (tenant_id,browser_token_hash) values ('${tenant}','${hash("f")}')`)), /permission denied/);
  assert.throws(() => sql(asService("insert into private.public_booking_intents default values")),
    /permission denied/);
  assert.throws(() => sql(asService(`select private.lock_public_booking_browser_session(
    '${tenant}','${hash("f")}',true)`)), /permission denied/);
  assert.throws(() => sql(asService(`select private.transition_public_booking_mode('legacy','frozen')`)),
    /permission denied/);

  const slots = JSON.parse(sql(`select json_agg(slot_start order by slot_start)
    from public.get_public_booking_slots('fixture-a','${service}',
      current_date + (8 - extract(dow from current_date)::integer))
    where staff_id='${staff}'`));
  assert.ok(slots.length >= 6);
  const [legacyStart, recoveryStart, concurrentStart] = [slots[0], slots[2], slots[4]];
  const legacy = heldTransaction(asService(`select appointment_id from public.create_public_appointment(
    'fixture-a','${service}','${staff}','${legacyStart}'::timestamptz,
    'Gate Legacy',null,'gate-legacy@example.invalid','en',
    '11111111-1111-4111-8111-111111111111');`));
  assert.equal(await assertTransitionWaits(legacy,
    "select private.transition_public_booking_mode('legacy','frozen')"), "frozen");
  assert.equal(sql("select mode from private.public_booking_contract_gate"), "frozen");
  const legacyCount = sql("select count(*) from public.appointments");
  const clientCount = sql("select count(*) from public.clients");
  assert.throws(() => sql(asService(`select * from public.create_public_appointment(
    'fixture-a','${service}','${staff}','${concurrentStart}'::timestamptz,
    'Gate Blocked',null,'gate-blocked@example.invalid','en',
    '22222222-2222-4222-8222-222222222222')`)), /booking_contract_closed/);
  assert.equal(sql("select count(*) from public.appointments"), legacyCount);
  assert.equal(sql("select count(*) from public.clients"), clientCount);

  assert.equal(sql("select private.transition_public_booking_mode('frozen','v2')"), "v2");
  assert.equal(sql("select ever_v2 from private.public_booking_contract_gate"), "t");
  sql(`insert into private.public_booking_intent_policy
    (prepared_ttl,retention_ttl,configured_at)
    values (interval '2 hours',interval '3 days',clock_timestamp())`);
  assert.equal(state(asService("select public.sweep_public_booking_intents(50)")).complete, true);

  const existingHash = hash("a");
  const existingGeneration = reconcile(existingHash).generation;
  const existing = state(prepare(existingHash, recoveryStart, existingGeneration,
    "gate-recovery@example.invalid"));
  assert.equal(existing.state, "prepared");
  const heldRecovery = heldTransaction(asService(`select public.reconcile_public_booking_intent(
    'fixture-a','${existingHash}','${existing.intent_id}')`));
  await heldRecovery.ready;
  try {
    await assert.rejects(asyncSql(`begin; set local lock_timeout='100ms';
      select private.transition_public_booking_mode('v2','v2_no_prepares'); commit;`),
    /lock timeout/);
    assert.equal(sql("select mode from private.public_booking_contract_gate"), "v2",
      "timed-out transition must leave admission unchanged");
  } finally {
    heldRecovery.release();
    await heldRecovery.done;
  }
  const raceHash = hash("b");
  const raceGeneration = reconcile(raceHash).generation;
  if (raceOrder === "prepare_first") {
    const heldPrepare = heldTransaction(prepare(raceHash, concurrentStart, raceGeneration,
      "gate-race@example.invalid"));
    assert.equal(await assertTransitionWaits(heldPrepare,
      "select private.transition_public_booking_mode('v2','v2_no_prepares')"), "v2_no_prepares");
  } else {
    const heldTransition = heldTransaction(
      "select private.transition_public_booking_mode('v2','v2_no_prepares');");
    await assert.rejects(assertTransitionWaits(heldTransition,
      prepare(raceHash, concurrentStart, raceGeneration,
        "gate-race@example.invalid")), /booking_contract_closed/);
  }
  assert.equal(sql(`select count(*) from private.public_booking_intents
    where browser_token_hash='${raceHash}'`), raceOrder === "prepare_first" ? "1" : "0");
  const totalBefore = sql("select count(*) from private.public_booking_intents");
  assert.throws(() => sql(prepare(hash("c"), recoveryStart, existingGeneration,
    "gate-new@example.invalid")), /booking_contract_closed/);
  assert.equal(sql("select count(*) from private.public_booking_intents"), totalBefore);
  const freshHash = hash("d");
  assert.equal(reconcile(freshHash).state, "unknown");
  assert.equal(sql(`select count(*) from private.public_booking_browser_sessions
    where browser_token_hash='${freshHash}'`), "0");
  assert.equal(reconcile(existingHash, `'${existing.intent_id}'`).state, "prepared");
  const committed = state(asService(`select public.commit_public_booking_intent(
    'fixture-a','${existingHash}','${existing.intent_id}')`));
  assert.equal(committed.state, "confirmed");
  assert.equal(reconcile(existingHash, `'${existing.intent_id}'`).state, "confirmed");
  assert.equal(sql(`select count(*) from public.appointments where id='${committed.confirmation.appointment_id}'`), "1");
  const acknowledged = state(asService(`select public.acknowledge_public_booking_intent(
    'fixture-a','${existingHash}','${existing.intent_id}')`));
  assert.equal(acknowledged.state, "none");
  if (raceOrder === "prepare_first") {
    const raceIntent = sql(`select id from private.public_booking_intents
      where browser_token_hash='${raceHash}'`);
    const canceled = state(asService(`select public.cancel_public_booking_intent(
      'fixture-a','${raceHash}','${raceIntent}')`));
    assert.equal(canceled.state, "not_committed");
  }
  assert.throws(() => sql("select private.transition_public_booking_mode('v2_no_prepares','legacy')"),
    /booking_contract_invalid_transition/);
  assert.equal(sql("select ever_v2 from private.public_booking_contract_gate"), "t");
});

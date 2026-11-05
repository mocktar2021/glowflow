import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const connection = process.env.GLOWFLOW_SANDBOX_TEST_DATABASE_URL;
const psql = process.env.PSQL_BIN || "psql";
const root = new URL("../", import.meta.url);
const service = "40000000-0000-0000-0000-000000000001";
const staff = "20000000-0000-0000-0000-000000000002";
const tenant = "10000000-0000-0000-0000-000000000001";
const token = (letter) => letter.repeat(64);

function safeError(message) {
  let text = String(message || "Local PostgreSQL command failed.");
  for (const value of [connection, connection && new URL(connection).password]) {
    if (value) text = text.replaceAll(value, "[redacted]");
  }
  return new Error(text.slice(0, 2500));
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
      ? resolve(stdout.trim().split("\n").at(-1))
      : reject(safeError(stderr)));
    child.stdin.end(input);
  });
}

function holdTransaction(input) {
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const child = spawn(psql, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", "-d", connection], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", value => {
    stdout += value;
    if (stdout.includes("LOCK_READY")) readyResolve();
  });
  child.stderr.setEncoding("utf8").on("data", value => { stderr += value; });
  const done = new Promise((resolve, reject) => {
    child.on("error", error => { readyReject(error); reject(error); });
    child.on("close", status => {
      if (!stdout.includes("LOCK_READY")) readyReject(safeError(stderr));
      status === 0 ? resolve(stdout) : reject(safeError(stderr));
    });
  });
  child.stdin.end(input);
  return { ready, done };
}

function rpc(name, args) {
  return `set role service_role; select public.${name}(${args});`;
}

function prepare(hash, start, email = "intent@example.invalid", expectedGeneration) {
  const generation = expectedGeneration ?? state(reconcile(hash)).generation;
  return rpc("prepare_public_booking_intent",
    `'fixture-a','${hash}','${service}','${staff}','${start}'::timestamptz,'Intent Fixture',null,'${email}','en','${generation}'::uuid`);
}
function commit(hash, id) {
  return rpc("commit_public_booking_intent", `'fixture-a','${hash}','${id}'`);
}
function cancel(hash, id) {
  return rpc("cancel_public_booking_intent", `'fixture-a','${hash}','${id}'`);
}
function reconcile(hash, id = "null") {
  return rpc("reconcile_public_booking_intent", `'fixture-a','${hash}',${id === "null" ? "null" : `'${id}'`}`);
}
function state(input) { return JSON.parse(sql(input)); }

test("GLOW-56 private intent fence, permissions and concurrent recovery", { skip: !connection, timeout: 120_000 }, async () => {
  const url = new URL(connection);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/glowflow_sandbox_test[0-9_]*$/);
  assert.ok(!url.search && !url.hash);
  assert.equal(sql("select count(*) from pg_tables where schemaname='public'"), "0");

  sql(readFileSync(new URL("tests/supabase-platform-fixture.sql", root), "utf8"));
  sql(readFileSync(new URL("supabase/schema.sql", root), "utf8"));
  for (const migration of readdirSync(new URL("supabase/migrations/", root)).filter(name => name.endsWith(".sql")).sort()) {
    try { sql(readFileSync(new URL(`supabase/migrations/${migration}`, root), "utf8")); }
    catch (error) { throw new Error(`Migration ${migration} failed: ${error.message}`); }
  }
  sql(readFileSync(new URL("tests/schema-authorization.sql", root), "utf8"));
  assert.equal(sql("select relrowsecurity from pg_class where oid='private.public_booking_intents'::regclass"), "t");
  assert.equal(sql("select relrowsecurity from pg_class where oid='private.public_booking_intent_policy'::regclass"), "t");
  assert.equal(sql("select relrowsecurity from pg_class where oid='private.public_booking_intent_cleanup_state'::regclass"), "t");
  assert.equal(sql("select count(*) from private.public_booking_intent_policy"), "0", "migration must not activate unapproved TTL policy");
  assert.equal(sql("select count(*) from private.public_booking_intent_cleanup_state"), "0", "migration must not claim a cleanup run");

  const signatures = [
    ["prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)",
      "null::text,null::text,null::uuid,null::uuid,null::timestamptz,null::text,null::text,null::text,null::text,null::uuid"],
    ["commit_public_booking_intent(text,text,uuid)", "null::text,null::text,null::uuid"],
    ["reconcile_public_booking_intent(text,text,uuid)", "null::text,null::text,null::uuid"],
    ["cancel_public_booking_intent(text,text,uuid)", "null::text,null::text,null::uuid"],
    ["acknowledge_public_booking_intent(text,text,uuid)", "null::text,null::text,null::uuid"],
    ["sweep_public_booking_intents(integer)", "null::integer"],
  ];
  for (const [signature, deniedArgs] of signatures) {
    assert.equal(sql(`select has_function_privilege('service_role','public.${signature}','execute')`), "t");
    for (const role of ["anon", "authenticated"]) {
      assert.equal(sql(`select has_function_privilege('${role}','public.${signature}','execute')`), "f");
      assert.throws(() => sql(`set role ${role}; select public.${signature.slice(0, signature.indexOf("("))}(${deniedArgs})`),
        /permission denied for function/);
    }
  }
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["public_booking_intents", "public_booking_intent_policy", "public_booking_browser_sessions", "public_booking_intent_cleanup_state"]) {
      assert.equal(sql(`select has_table_privilege('${role}','private.${table}','select')`), "f");
      assert.throws(() => sql(`set role ${role}; select count(*) from private.${table}`), /permission denied/);
    }
  }

  const slots = JSON.parse(sql(`select json_agg(slot_start order by slot_start)
    from public.get_public_booking_slots('fixture-a','${service}',
      current_date + (8 - extract(dow from current_date)::integer))
    where staff_id='${staff}'`));
  assert.ok(slots.length >= 10, "fixture must have distinct nonoverlapping Monday slots");
  const [s0, s1, s2, s3, s4] = [slots[0], slots[2], slots[4], slots[6], slots[8]];

  assert.equal(state(prepare(token("8"), s0, "unbootstrapped@example.invalid",
    "11111111-1111-4111-8111-111111111111")).state, "unknown",
  "prepare cannot mint an epoch for an unbootstrapped browser");
  assert.throws(() => state(prepare(token("a"), s0)), /booking_intent_policy_unconfigured/);
  assert.throws(() => sql(`insert into private.public_booking_intent_policy
    (prepared_ttl,retention_ttl,configured_at)
    values (interval '24 hours', interval '7 days', clock_timestamp())`),
  /violates check constraint/, "unapproved long retention must not be configured");
  sql(`insert into private.public_booking_intent_policy
    (prepared_ttl,retention_ttl,configured_at)
    values (interval '2 hours', interval '3 days', clock_timestamp())`);
  assert.throws(() => state(prepare(token("4"), s0)), /booking_intent_cleanup_stale/,
    "new preparation must fail closed before the first full cleanup sweep");
  assert.equal(state(rpc("sweep_public_booking_intents", "50")).complete, true,
    "empty first sweep establishes the cleanup freshness gate");
  sql("update private.public_booking_intent_cleanup_state set last_full_sweep_at=clock_timestamp()+interval '1 hour'");
  assert.throws(() => state(prepare(token("4"), s0)), /booking_intent_cleanup_stale/,
    "a future-dated cleanup heartbeat must not keep preparation open indefinitely");
  assert.equal(sql("select count(*) from private.public_booking_intents"), "0");
  assert.equal(state(rpc("sweep_public_booking_intents", "50")).complete, true,
    "a complete sweep restores a current cleanup heartbeat");
  const tabGeneration = state(reconcile(token("5"))).generation;
  const tabPrepares = await Promise.all([
    asyncSql(prepare(token("5"), s0, "tab-one@example.invalid", tabGeneration)),
    asyncSql(prepare(token("5"), s1, "tab-two@example.invalid", tabGeneration)),
  ]);
  assert.deepEqual(tabPrepares.map(JSON.parse).map(result => result.state).sort(),
    ["prepared", "unknown"], "two tabs cannot prepare different active keys");
  const tabIntent = tabPrepares.map(JSON.parse).find(result => result.state === "prepared");
  assert.equal(state(cancel(token("5"), tabIntent.intent_id)).state, "not_committed");
  const first = state(prepare(token("a"), s0));
  assert.equal(first.state, "prepared");
  assert.equal(sql(`select (expires_at = least(created_at + interval '2 hours', requested_start))::text
    from private.public_booking_intents where id='${first.intent_id}'`), "true",
  "prepared expiry is the earlier of the owner-approved TTL and slot start");
  assert.match(first.generation, /^[0-9a-f-]{36}$/);
  assert.equal(state(prepare(token("a"), s0)).intent_id, first.intent_id);
  assert.equal(state(prepare(token("a"), s1)).state, "unknown", "changed payload cannot mint a new key");
  assert.equal(sql(`select count(*) from private.public_booking_intents where browser_token_hash='${token("a")}'`), "1");
  assert.equal(state(reconcile(token("b"), first.intent_id)).state, "unknown", "forged cookie cannot recover");
  assert.equal(state(rpc("reconcile_public_booking_intent", `'fixture-b','${token("a")}','${first.intent_id}'`)).state,
    "unknown", "foreign tenant cannot recover");
  assert.equal(state(reconcile(token("a"), "11111111-1111-4111-8111-111111111111")).state,
    "unknown", "known missing ID cannot be treated as first-time");
  assert.equal(state(reconcile(token("9"))).state, "none", "new cookie with no known ID is first-time only");
  const confirmed = state(commit(token("a"), first.intent_id));
  assert.equal(confirmed.state, "confirmed");
  assert.equal(confirmed.confirmation.confirmed_start, s0);
  const savedServiceTitle = confirmed.confirmation.service_title;
  assert.deepEqual(savedServiceTitle, JSON.parse(sql(`select service_title_json
    from public.appointments where id='${confirmed.confirmation.appointment_id}'`)));
  assert.equal(state(commit(token("a"), first.intent_id)).confirmation.appointment_id,
    confirmed.confirmation.appointment_id);
  assert.equal(state(reconcile(token("a"))).confirmation.appointment_id,
    confirmed.confirmation.appointment_id);
  assert.equal(state(cancel(token("a"), first.intent_id)).state, "confirmed", "cancel must not undo a booking");
  assert.equal(sql(`select count(*) from private.public_booking_intents
    where id='${first.intent_id}' and client_full_name is null and client_email is null`), "1");
  sql(`update public.services set is_active=false,
    title_json='{"fr":"Titre modifié","en":"Changed title","es":"Título cambiado"}'::jsonb
    where id='${service}';
    update public.salon_public_profiles set is_published=false where tenant_id='${tenant}'`);
  assert.notDeepEqual(JSON.parse(sql(`select title_json from public.services where id='${service}'`)),
    savedServiceTitle, "catalog edit must change the current title");
  assert.equal(state(prepare(token("a"), s1)).state, "confirmed",
    "stored success must be recoverable after catalog/publication changes");
  const recovered = state(reconcile(token("a"), first.intent_id));
  assert.equal(recovered.state, "confirmed");
  assert.deepEqual(recovered.confirmation.service_title, savedServiceTitle,
    "recovery must use the booked title snapshot, not the edited catalog title");
  sql(`update public.appointments set start_time='${s1}'::timestamptz
    where id='${confirmed.confirmation.appointment_id}'`);
  assert.equal(sql(`select count(*) from public.appointments as appointment
    join private.public_booking_intents as intent on intent.appointment_id=appointment.id
    where intent.id='${first.intent_id}'
      and appointment.public_booking_request_key=intent.request_key
      and appointment.start_time='${s1}'::timestamptz`), "1",
  "same-key appointment fixture must have a different start than the intent");
  assert.equal(state(reconcile(token("a"), first.intent_id)).state, "unknown",
    "a same-key appointment at the wrong time cannot be recovered as confirmation");
  assert.equal(state(commit(token("a"), first.intent_id)).state, "unknown",
    "committed replay cannot confirm a different appointment time");
  sql(`update public.appointments set start_time='${s0}'::timestamptz
    where id='${confirmed.confirmation.appointment_id}'`);
  assert.deepEqual(state(reconcile(token("a"), first.intent_id)).confirmation.service_title,
    savedServiceTitle, "restored appointment recovers the original title snapshot");
  sql(`update public.services set is_active=true where id='${service}';
    update public.salon_public_profiles set is_published=true where tenant_id='${tenant}'`);
  assert.equal(state(prepare(token("a"), s1)).state, "confirmed", "unacknowledged success blocks another booking");
  const acknowledged = state(rpc("acknowledge_public_booking_intent",
    `'fixture-a','${token("a")}','${first.intent_id}'`));
  assert.equal(acknowledged.state, "none");
  assert.notEqual(acknowledged.generation, first.generation, "ack rotates the browser generation");
  assert.equal(state(prepare(token("a"), s1, "stale@example.invalid", first.generation)).state,
    "unknown", "delayed old prepare cannot use pre-ack generation");
  const canceled = state(prepare(token("a"), s1));
  assert.equal(canceled.state, "prepared");
  const canceledResult = state(cancel(token("a"), canceled.intent_id));
  assert.equal(canceledResult.state, "not_committed");
  assert.notEqual(canceledResult.generation, canceled.generation);
  assert.equal(state(prepare(token("a"), s2, "stale@example.invalid", canceled.generation)).state,
    "unknown", "delayed prepare cannot cross canceled-intent release");
  const afterCancel = state(prepare(token("a"), s2));
  assert.notEqual(afterCancel.intent_id, canceled.intent_id);
  assert.equal(state(commit(token("a"), canceled.intent_id)).state, "not_committed",
    "late old POST cannot create after newer intent is prepared");
  assert.equal(state(reconcile(token("a"), canceled.intent_id)).state, "not_committed");
  assert.equal(sql(`select count(*) from public.appointments where tenant_id='${tenant}'
    and public_booking_request_key=(select request_key from private.public_booking_intents where id='${canceled.intent_id}')`), "0");
  assert.equal(state(cancel(token("a"), afterCancel.intent_id)).state, "not_committed");
  assert.equal(state(rpc("acknowledge_public_booking_intent",
    `'fixture-a','${token("a")}','${first.intent_id}'`)).generation,
  acknowledged.generation, "duplicate old acknowledgement cannot gift a newer generation");

  // An old prepare may be sent before acknowledgement but reach the DB only
  // after it. The server epoch, not a client-side marker, must reject it.
  const stale = state(prepare(token("6"), s1, "stale-tab@example.invalid"));
  assert.equal(state(commit(token("6"), stale.intent_id)).state, "confirmed");
  const acknowledging = holdTransaction(`begin; set local role service_role;
    select public.acknowledge_public_booking_intent('fixture-a','${token("6")}','${stale.intent_id}');
    select 'LOCK_READY'; select pg_sleep(1); commit;`);
  await acknowledging.ready;
  const oldPrepare = asyncSql(prepare(token("6"), s2, "stale-tab@example.invalid", stale.generation));
  await acknowledging.done;
  assert.equal(JSON.parse(await oldPrepare).state, "unknown",
    "old prepare queued before ack cannot mint a new key after epoch rotation");

  // A committed transaction holds the intent row until COMMIT. Cancellation
  // must wait and return the original confirmation, never a false noncommit.
  const commitWins = state(prepare(token("c"), s2, "commit-wins@example.invalid"));
  const committing = holdTransaction(`begin; set local role service_role;
    select public.commit_public_booking_intent('fixture-a','${token("c")}','${commitWins.intent_id}');
    select 'LOCK_READY'; select pg_sleep(1); commit;`);
  await committing.ready;
  const cancelAfterCommit = asyncSql(cancel(token("c"), commitWins.intent_id));
  await committing.done;
  assert.equal(JSON.parse(await cancelAfterCommit).state, "confirmed");
  assert.equal(sql(`select count(*) from public.appointments where tenant_id='${tenant}'
    and public_booking_request_key=(select request_key from private.public_booking_intents where id='${commitWins.intent_id}')`), "1");

  // Cancellation wins the lock while an original commit waits. A subsequent
  // new intent cannot be followed by a late commit of the canceled one.
  const cancelWins = state(prepare(token("d"), s3, "cancel-wins@example.invalid"));
  const canceling = holdTransaction(`begin; set local role service_role;
    select public.cancel_public_booking_intent('fixture-a','${token("d")}','${cancelWins.intent_id}');
    select 'LOCK_READY'; select pg_sleep(1); commit;`);
  await canceling.ready;
  const commitAfterCancel = asyncSql(commit(token("d"), cancelWins.intent_id));
  await canceling.done;
  assert.equal(JSON.parse(await commitAfterCancel).state, "not_committed");
  const newer = state(prepare(token("d"), s4, "newer@example.invalid"));
  assert.equal(newer.state, "prepared");
  assert.equal(state(commit(token("d"), cancelWins.intent_id)).state, "not_committed");
  assert.equal(state(cancel(token("d"), newer.intent_id)).state, "not_committed");

  // Two same-key commit requests serialize and return one appointment/client.
  const concurrent = state(prepare(token("e"), s3, "concurrent@example.invalid"));
  const [commitOne, commitTwo] = await Promise.all([
    asyncSql(commit(token("e"), concurrent.intent_id)),
    asyncSql(commit(token("e"), concurrent.intent_id)),
  ]);
  assert.equal(JSON.parse(commitOne).state, "confirmed");
  assert.equal(JSON.parse(commitTwo).confirmation.appointment_id, JSON.parse(commitOne).confirmation.appointment_id);
  assert.equal(sql(`select count(*) from public.appointments where tenant_id='${tenant}'
    and public_booking_request_key=(select request_key from private.public_booking_intents where id='${concurrent.intent_id}')`), "1");
  assert.equal(sql("select count(*) from public.clients where email='concurrent@example.invalid'"), "1");

  // A commit that started before expiry but waited for the row lock must use
  // post-lock wall time, not the transaction's original now().
  const expiring = state(prepare(token("f"), s4, "expiring@example.invalid"));
  sql(`update private.public_booking_intents set expires_at=clock_timestamp()+interval '1 second'
    where id='${expiring.intent_id}'`);
  const expiryHolder = holdTransaction(`begin;
    select id from private.public_booking_intents where id='${expiring.intent_id}' for update;
    select 'LOCK_READY'; select pg_sleep(2); commit;`);
  await expiryHolder.ready;
  const commitAfterExpiry = asyncSql(commit(token("f"), expiring.intent_id));
  await expiryHolder.done;
  assert.equal(JSON.parse(await commitAfterExpiry).state, "not_committed");
  assert.equal(sql(`select state from private.public_booking_intents where id='${expiring.intent_id}'`), "expired");
  assert.equal(sql("select count(*) from public.clients where email='expiring@example.invalid'"), "0");

  // Prepare must terminalize an expired row under the same lock before the
  // unique active-browser index can admit a different request key.
  const old = state(prepare(token("7"), s4, "old@example.invalid"));
  sql(`update private.public_booking_intents set expires_at=clock_timestamp()+interval '1 second'
    where id='${old.intent_id}'`);
  const prepareHolder = holdTransaction(`begin;
    select id from private.public_booking_intents where id='${old.intent_id}' for update;
    select 'LOCK_READY'; select pg_sleep(2); commit;`);
  await prepareHolder.ready;
  const prepareAfterExpiry = asyncSql(prepare(token("7"), s1,
    "replacement@example.invalid", old.generation));
  await prepareHolder.done;
  const expiredByPrepare = JSON.parse(await prepareAfterExpiry);
  assert.equal(expiredByPrepare.state, "not_committed");
  assert.notEqual(expiredByPrepare.generation, old.generation);
  assert.equal(state(prepare(token("7"), s1,
    "stale-after-expiry@example.invalid", old.generation)).state,
  "unknown", "old epoch cannot create a new intent after expiry");
  const replacement = state(prepare(token("7"), s1,
    "replacement@example.invalid", expiredByPrepare.generation));
  assert.equal(replacement.state, "prepared");
  assert.notEqual(replacement.intent_id, old.intent_id);
  assert.equal(state(commit(token("7"), old.intent_id)).state, "not_committed");
  assert.equal(sql(`select state from private.public_booking_intents where id='${old.intent_id}'`), "expired");
  assert.equal(state(cancel(token("7"), replacement.intent_id)).state, "not_committed");

  // The service-role sweep expires abandoned prepared rows at the earlier of
  // slot start and TTL, without relying on a visitor RPC or a policy row.
  const abandoned = state(prepare(token("2"), s4, "abandoned@example.invalid"));
  const secondAbandoned = state(prepare(token("3"), s4, "second-abandoned@example.invalid"));
  sql(`update private.public_booking_intents
    set requested_start=clock_timestamp()-interval '1 second'
    where id in ('${abandoned.intent_id}','${secondAbandoned.intent_id}');
    update private.public_booking_intents
    set terminal_at=clock_timestamp()-interval '4 days'
    where id in ('${canceled.intent_id}','${old.intent_id}');
    delete from private.public_booking_intent_policy`);
  const firstSweep = state(rpc("sweep_public_booking_intents", "1"));
  assert.equal(firstSweep.complete, false, "bounded backlog must not refresh the preparation gate");
  assert.equal(firstSweep.scrubbed, 1);
  assert.equal(sql("select count(*) from private.public_booking_intent_cleanup_state where last_full_sweep_at is null"), "1");
  const secondSweep = state(rpc("sweep_public_booking_intents", "1"));
  assert.equal(secondSweep.complete, false);
  assert.equal(secondSweep.scrubbed, 1);
  assert.equal(state(rpc("sweep_public_booking_intents", "1")).purged, 1);
  const backlogDrain = state(rpc("sweep_public_booking_intents", "1"));
  assert.equal(backlogDrain.purged, 1);
  assert.equal(backlogDrain.complete, true,
    "terminal backlog drains after prepared PII is scrubbed first");
  assert.equal(sql(`select count(*) from private.public_booking_intents
    where id in ('${abandoned.intent_id}','${secondAbandoned.intent_id}')
      and state='expired' and client_full_name is null and client_phone is null and client_email is null`), "2");
  assert.notEqual(state(reconcile(token("2"), abandoned.intent_id)).generation,
    abandoned.generation, "sweep must fence a stale browser generation");
  assert.equal(state(prepare(token("2"), s4, "stale@example.invalid", abandoned.generation)).state,
    "unknown", "sweep must reject a delayed old prepare");

  // Terminal records and orphan browser hashes are pruned only after three
  // days; the exact-ID recovery fence remains until that retention deadline.
  sql(`update private.public_booking_intents
    set terminal_at=clock_timestamp()-interval '4 days'
    where id='${abandoned.intent_id}';
    update private.public_booking_browser_sessions
    set created_at=clock_timestamp()-interval '5 days',
        updated_at=clock_timestamp()-interval '4 days',
        expires_at=clock_timestamp()-interval '4 days'
    where tenant_id='${tenant}' and browser_token_hash='${token("2")}'`);
  assert.equal(state(rpc("sweep_public_booking_intents", "1")).complete, false);
  assert.equal(sql(`select count(*) from private.public_booking_intents where id='${abandoned.intent_id}'`), "0");
  const sessionSweep = state(rpc("sweep_public_booking_intents", "1"));
  assert.equal(sessionSweep.complete, true);
  assert.equal(sessionSweep.sessions_purged, 1);
  assert.equal(sql(`select count(*) from private.public_booking_browser_sessions
    where tenant_id='${tenant}' and browser_token_hash='${token("2")}'`), "0");
  const agedSession = state(reconcile(token("1")));
  assert.equal(agedSession.state, "none");
  sql(`update private.public_booking_browser_sessions
    set created_at=clock_timestamp()-interval '25 hours',
        expires_at=clock_timestamp()-interval '1 second'
    where tenant_id='${tenant}' and browser_token_hash='${token("1")}'`);
  assert.equal(state(reconcile(token("1"))).state, "unknown",
    "a replayed 24-hour-old browser cookie cannot use an existing session");
  assert.equal(state(prepare(token("1"), s4, "replayed@example.invalid",
    agedSession.generation)).state, "unknown",
  "expired browser sessions cannot prepare even with the original generation");
  const rollback = readFileSync(new URL(
    "supabase/rollbacks/20261104184112_drop_private_public_booking_intents.sql", root), "utf8");
  assert.throws(() => sql(rollback),
  /booking_intent_rows_present_preserve_fence/, "rollback must preserve every existing fence");
  sql("delete from private.public_booking_intents; delete from private.public_booking_browser_sessions");
  sql(rollback);
  for (const table of ["public_booking_intents", "public_booking_browser_sessions",
    "public_booking_intent_policy", "public_booking_intent_cleanup_state"]) {
    assert.equal(sql(`select to_regclass('private.${table}') is null`), "t",
      `empty-state rollback must remove ${table}`);
  }
  assert.equal(sql("select to_regprocedure('public.sweep_public_booking_intents(integer)') is null"), "t");
  assert.equal(sql("select to_regprocedure('private.lock_public_booking_browser_session(uuid,text,boolean,boolean)') is null"), "t");
});

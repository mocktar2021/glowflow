import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const connection = process.env.GLOWFLOW_SANDBOX_TEST_DATABASE_URL;
const psql = process.env.PSQL_BIN || "psql";
const root = new URL("../", import.meta.url);
const digest = letter => letter.repeat(64);
const capabilityDigest = label => createHmac("sha256", "local-test-only-capability-key")
  .update(label).digest("hex");
const browserCapabilityDigest = browser => capabilityDigest(`browser:${browser}`);
const intentCapabilityDigest = (browser, intent) => capabilityDigest(`intent:${browser}:${intent}`);

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

const consume = (action, ip, browser = null, slug = null) =>
  `set role service_role; select public.consume_public_booking_quota('${action}',
    '${digest(ip)}', ${browser ? `'${digest(browser)}'` : "null"},
    ${slug ? `'${slug}'` : "null"});`;
const consumeCapability = (action, browser, intent, slug = "fixture-a") =>
  `set role service_role; select public.consume_public_booking_capability_quota('${action}',
    '${browserCapabilityDigest(browser)}', '${intentCapabilityDigest(browser, intent)}', '${slug}');`;
const state = input => JSON.parse(sql(input));

test("capability quota fixtures are valid, domain-separated HMACs", () => {
  const browser = browserCapabilityDigest("g");
  const intent = intentCapabilityDigest("g", "h");
  assert.match(browser, /^[0-9a-f]{64}$/);
  assert.match(intent, /^[0-9a-f]{64}$/);
  assert.notEqual(browser, intent);
  assert.notEqual(intent, intentCapabilityDigest("g", "i"));
});

test("GLOW-56 dormant quota is tenant-scoped, atomic, and bounded", { skip: !connection, timeout: 120_000 }, async () => {
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

  for (const table of ["public_booking_quota_policy", "public_booking_quota_cleanup_state", "public_booking_quota_counters"]) {
    assert.equal(sql(`select relrowsecurity from pg_class where oid='private.${table}'::regclass`), "t");
    for (const role of ["anon", "authenticated"]) {
      assert.equal(sql(`select has_table_privilege('${role}','private.${table}','select')`), "f");
      assert.throws(() => sql(`set role ${role}; select count(*) from private.${table}`), /permission denied/);
    }
  }
  for (const signature of [
    "consume_public_booking_quota(text,text,text,text)",
    "consume_public_booking_capability_quota(text,text,text,text)",
    "sweep_public_booking_quota_counters(integer)",
  ]) {
    assert.equal(sql(`select has_function_privilege('service_role','public.${signature}','execute')`), "t");
    for (const role of ["anon", "authenticated"]) {
      assert.equal(sql(`select has_function_privilege('${role}','public.${signature}','execute')`), "f");
      const call = signature.startsWith("consume_public_booking_capability")
        ? `public.consume_public_booking_capability_quota('commit','${digest("a")}',
          '${digest("b")}','fixture-a')`
        : signature.startsWith("consume_")
          ? `public.consume_public_booking_quota('bootstrap','${digest("a")}',null,null)`
          : "public.sweep_public_booking_quota_counters(1)";
      assert.throws(() => sql(`set role ${role}; select ${call}`), /permission denied for function/);
    }
  }
  assert.equal(sql("select count(*) from private.public_booking_quota_policy"), "0");
  assert.equal(sql("select count(*) from private.public_booking_quota_cleanup_state"), "0");
  assert.throws(() => state(consume("bootstrap", "a")), /booking_quota_policy_unconfigured/);
  assert.throws(() => state(consumeCapability("commit", "a", "b")),
    /booking_capability_quota_policy_unconfigured/);
  assert.throws(() => state(consumeCapability("prepare", "a", "b")),
    /booking_capability_quota_invalid_request/);
  assert.throws(() => state(`set role service_role; select public.consume_public_booking_capability_quota(
    'commit','not-a-digest','${digest("b")}','fixture-a')`),
    /booking_capability_quota_invalid_request/);
  assert.throws(() => state(consume("bootstrap", "a", "b")), /booking_quota_invalid_request/);
  assert.throws(() => state(`set role service_role; select public.consume_public_booking_quota(
    'bootstrap','127.0.0.1',null,null)`), /booking_quota_invalid_request/);

  sql(`insert into private.public_booking_quota_policy
    (action_bucket,window_seconds,ip_limit,browser_tenant_limit,configured_at)
    values ('bootstrap',600,2,null,clock_timestamp()),
      ('prepare',600,3,1,clock_timestamp()),
      ('reconcile',600,5,2,clock_timestamp())`);
  sql(`insert into private.public_booking_quota_policy
    (action_bucket,window_seconds,ip_limit,browser_tenant_limit,intent_limit,configured_at)
    values ('commit',600,null,3,1,clock_timestamp()),
      ('cancel',600,null,2,2,clock_timestamp()),
      ('acknowledge',600,null,2,2,clock_timestamp())`);
  assert.throws(() => state(consume("bootstrap", "a")), /booking_quota_cleanup_stale/);
  assert.equal(state("set role service_role; select public.sweep_public_booking_quota_counters(100)").complete, true);
  sql("update private.public_booking_quota_cleanup_state set last_full_sweep_at=clock_timestamp()+interval '1 hour'");
  assert.throws(() => state(consume("bootstrap", "0")), /booking_quota_cleanup_stale/,
    "a future cleanup timestamp must not keep admission open indefinitely");
  assert.equal(state("set role service_role; select public.sweep_public_booking_quota_counters(100)").complete, true);

  assert.equal(state(consume("bootstrap", "a")).allowed, true);
  assert.equal(state(consume("bootstrap", "a")).allowed, true);
  const deniedBootstrap = state(consume("bootstrap", "a"));
  assert.equal(deniedBootstrap.allowed, false);
  assert.ok(deniedBootstrap.retry_after >= 1 && deniedBootstrap.retry_after <= 600);
  assert.equal(sql(`select hits from private.public_booking_quota_counters
    where action_bucket='bootstrap' and key_digest='${digest("a")}'`), "2");

  assert.equal(state(consume("prepare", "b", "c", "fixture-a")).allowed, true);
  assert.equal(state(consume("prepare", "b", "c", "fixture-a")).allowed, false);
  assert.equal(sql(`select hits from private.public_booking_quota_counters
    where action_bucket='prepare' and scope='ip' and key_digest='${digest("b")}'`), "1",
  "exhausted browser bucket must not burn shared IP capacity");
  assert.equal(state(consume("prepare", "b", "d", "fixture-a")).allowed, true);
  assert.equal(state(consume("prepare", "b", "e", "fixture-a")).allowed, true);
  assert.equal(state(consume("prepare", "b", "f", "fixture-a")).allowed, false);
  assert.equal(sql(`select hits from private.public_booking_quota_counters
    where action_bucket='prepare' and scope='ip' and key_digest='${digest("b")}'`), "3");
  assert.equal(state(consume("prepare", "f", "c", "fixture-b")).allowed, true,
    "the browser bucket is isolated by tenant");

  assert.throws(() => state(consumeCapability("commit", "g", "h", "missing-tenant")),
    /booking_capability_quota_invalid_request/);
  assert.equal(state(consumeCapability("commit", "g", "h")).allowed, true);
  const deniedIntent = state(consumeCapability("commit", "g", "h"));
  assert.equal(deniedIntent.allowed, false);
  assert.ok(deniedIntent.retry_after >= 1 && deniedIntent.retry_after <= 600);
  assert.equal(sql(`select hits from private.public_booking_quota_counters
    where action_bucket='commit' and scope='browser_tenant' and key_digest='${browserCapabilityDigest("g")}'`), "1",
  "an exhausted intent bucket must not burn browser capacity");
  assert.equal(state(consumeCapability("commit", "g", "i")).allowed, true);
  assert.equal(state(consumeCapability("commit", "g", "j")).allowed, true);
  assert.equal(state(consumeCapability("commit", "g", "k")).allowed, false,
    "rotating intent IDs must still exhaust the browser budget");
  assert.equal(sql(`select hits from private.public_booking_quota_counters
    where action_bucket='commit' and scope='browser_tenant' and key_digest='${browserCapabilityDigest("g")}'`), "3");
  assert.equal(sql(`select count(*) from private.public_booking_quota_counters
    where action_bucket='commit' and scope='intent_capability'
      and key_digest='${intentCapabilityDigest("g", "k")}'`), "0",
  "a denied browser bucket must not burn intent capacity");
  assert.equal(state(consumeCapability("commit", "g", "h", "fixture-b")).allowed, true,
    "capability buckets are isolated by tenant");
  assert.equal(state(consumeCapability("cancel", "g", "h")).allowed, true,
    "a full commit budget must not starve cancellation");
  assert.equal(state(consumeCapability("acknowledge", "g", "h")).allowed, true,
    "a full commit budget must not starve acknowledgement");

  assert.equal(state(consume("reconcile", "1", "2", "fixture-a")).allowed, true);
  assert.equal(state(consume("reconcile", "1", "2", "fixture-a")).allowed, true);
  assert.equal(state(consume("reconcile", "1", "2", "fixture-a")).allowed, false);
  sql("update private.public_booking_quota_cleanup_state set last_full_sweep_at=clock_timestamp()-interval '3 hours'");
  assert.throws(() => state(consume("prepare", "f", "4", "fixture-a")), /booking_quota_cleanup_stale/);
  assert.equal(state(consume("reconcile", "1", "3", "fixture-a")).allowed, true,
    "existing recovery budget remains usable when new prepares are stale-gated");
  assert.equal(state(consumeCapability("cancel", "l", "m")).allowed, true,
    "bounded existing-capability recovery must remain usable when cleanup is stale");
  assert.equal(state("set role service_role; select public.sweep_public_booking_quota_counters(100)").complete, true);

  const concurrent = await Promise.all([
    asyncSql(consume("bootstrap", "5")), asyncSql(consume("bootstrap", "5")),
    asyncSql(consume("bootstrap", "5")),
  ]);
  assert.deepEqual(concurrent.map(JSON.parse).map(value => value.allowed).sort(), [false, true, true]);
  assert.equal(sql(`select hits from private.public_booking_quota_counters
    where action_bucket='bootstrap' and key_digest='${digest("5")}'`), "2",
  "concurrent calls must not exceed the cap");

  const concurrentCapability = await Promise.all([
    asyncSql(consumeCapability("cancel", "n", "o")),
    asyncSql(consumeCapability("cancel", "n", "o")),
    asyncSql(consumeCapability("cancel", "n", "o")),
  ]);
  assert.deepEqual(concurrentCapability.map(JSON.parse).map(value => value.allowed).sort(),
    [false, true, true]);
  for (const scope of ["browser_tenant", "intent_capability"]) {
    assert.equal(sql(`select hits from private.public_booking_quota_counters
      where action_bucket='cancel' and scope='${scope}' and key_digest='${scope === "browser_tenant" ? browserCapabilityDigest("n") : intentCapabilityDigest("n", "o")}'`), "2",
    `concurrent calls must not exceed the ${scope} cap`);
  }

  const secondsToWindowEnd = Number(sql(`select 600 -
    (floor(extract(epoch from clock_timestamp()))::bigint % 600)`));
  if (secondsToWindowEnd <= 20) {
    await new Promise(resolve => setTimeout(resolve, (secondsToWindowEnd + 1) * 1000));
  }
  assert.ok(Number(sql(`select 600 -
    (floor(extract(epoch from clock_timestamp()))::bigint % 600)`)) > 20,
  "cross-zone test needs a stable quota window longer than its held transaction");
  sql("update private.public_booking_quota_policy set ip_limit=1 where action_bucket='bootstrap'");
  const held = asyncSql(`begin; set role service_role; set time zone 'Pacific/Honolulu';
    set application_name = 'glow56_quota_cross_zone_hold';
    select public.consume_public_booking_quota('bootstrap','${digest("9")}',null,null);
    select pg_sleep(3); commit;`);
  const waitForHeldCall = async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (sql(`select count(*) from pg_stat_activity where datname=current_database()
        and application_name='glow56_quota_cross_zone_hold'
        and state='active' and query like '%pg_sleep(3)%'`) === "1") return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("first quota transaction did not reach its held state");
  };
  await Promise.race([waitForHeldCall(), held.then(() => { throw new Error("first quota call ended before held state"); })]);
  const crossZone = JSON.parse(await asyncSql(`set role service_role; set time zone 'Asia/Tokyo';
    select public.consume_public_booking_quota('bootstrap','${digest("9")}',null,null);`));
  assert.equal(crossZone.allowed, false,
    "different session TimeZones must share the same advisory lock and quota window");
  await held;
  assert.equal(sql(`select hits from private.public_booking_quota_counters
    where action_bucket='bootstrap' and key_digest='${digest("9")}'`), "1");
  sql("update private.public_booking_quota_policy set ip_limit=2 where action_bucket='bootstrap'");

  sql(`insert into private.public_booking_quota_counters
    (action_bucket,scope,tenant_id,key_digest,window_start,hits,expires_at)
    values ('bootstrap','ip','00000000-0000-0000-0000-000000000000','${digest("6")}',
      now()-interval '25 hours',1,now()-interval '1 hour'),
      ('bootstrap','ip','00000000-0000-0000-0000-000000000000','${digest("7")}',
      now()-interval '25 hours',1,now()-interval '1 hour')`);
  const firstSweep = state("set role service_role; select public.sweep_public_booking_quota_counters(1)");
  assert.equal(firstSweep.removed, 1);
  assert.equal(firstSweep.complete, false);
  const secondSweep = state("set role service_role; select public.sweep_public_booking_quota_counters(1)");
  assert.equal(secondSweep.removed, 1);
  assert.equal(secondSweep.complete, true);
  sql(`insert into private.public_booking_quota_counters
    (action_bucket,scope,tenant_id,key_digest,window_start,hits,expires_at)
    select 'commit','intent_capability',tenant.id,'${intentCapabilityDigest("p", "q")}',
      now()-interval '25 hours',1,now()-interval '1 hour'
    from public.tenants as tenant where tenant.slug='fixture-a'`);
  const capabilitySweep = state("set role service_role; select public.sweep_public_booking_quota_counters(1)");
  assert.equal(capabilitySweep.removed, 1);
  assert.equal(capabilitySweep.complete, true,
    "the bounded sweep must also remove expired capability counters");
  assert.equal(state(consume("bootstrap", "8")).allowed, true,
    "full sweep restores admission after a stale gate");

  const rollback = readFileSync(new URL("supabase/rollbacks/20261104234445_drop_public_booking_quota.sql", root), "utf8");
  assert.throws(() => sql(rollback), /booking_quota_rows_present_preserve_limit/,
    "rollback must preserve a configured or used quota");
  sql("delete from private.public_booking_quota_counters; delete from private.public_booking_quota_policy");
  sql(`insert into private.public_booking_quota_counters
    (action_bucket,scope,tenant_id,key_digest,window_start,hits,expires_at)
    select 'cancel','intent_capability',tenant.id,'${intentCapabilityDigest("q", "r")}',
      now(),1,now()+interval '1 hour'
    from public.tenants as tenant where tenant.slug='fixture-a'`);
  assert.throws(() => sql(rollback), /booking_quota_rows_present_preserve_limit/,
    "rollback must refuse a capability counter even without policy rows");
  sql("delete from private.public_booking_quota_counters");
  assert.equal(sql("select count(*) from private.public_booking_quota_cleanup_state"), "1");
  assert.throws(() => sql(rollback), /booking_quota_rows_present_preserve_limit/,
    "rollback must preserve the last quota cleanup heartbeat");
  assert.equal(sql("select to_regclass('private.public_booking_quota_policy') is not null"), "t");
  sql("delete from private.public_booking_quota_cleanup_state");
  assert.throws(() => sql(rollback), /booking_quota_rollback_requires_gate_removed/,
    "quota rollback must not orphan the installed contract gate");
  const gateRollback = readFileSync(new URL(
    "supabase/rollbacks/20261105124804_drop_public_booking_contract_gate.sql", root), "utf8");
  sql(gateRollback);
  sql(rollback);
  assert.equal(sql("select to_regprocedure('public.consume_public_booking_quota(text,text,text,text)') is null"), "t");
  assert.equal(sql("select to_regprocedure('public.consume_public_booking_capability_quota(text,text,text,text)') is null"), "t");
});

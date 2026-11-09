import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const connection = process.env.GLOWFLOW_SANDBOX_TEST_DATABASE_URL;
const psql = process.env.PSQL_BIN || 'psql';
const root = new URL('../', import.meta.url);
const service = '40000000-0000-0000-0000-000000000001';
const staff = '20000000-0000-0000-0000-000000000002';
const hash = letter => letter.repeat(64);

function sql(input) {
  const result = spawnSync(psql, ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-At', '-d', connection], {
    input, encoding: 'utf8', timeout: 90_000,
  });
  if (result.status !== 0) {
    let message = result.error?.message || result.stderr || 'Local PostgreSQL command failed';
    for (const value of [connection, connection && new URL(connection).password]) {
      if (value) message = message.replaceAll(value, '[redacted]');
    }
    throw new Error(message.slice(0, 2500));
  }
  return result.stdout.trim().split('\n').at(-1);
}

function asyncSql(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-At', '-d', connection], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', value => { stdout += value; });
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve(stdout.trim().split('\n').at(-1));
      let message = stderr || 'Local PostgreSQL command failed';
      for (const value of [connection, connection && new URL(connection).password]) {
        if (value) message = message.replaceAll(value, '[redacted]');
      }
      return reject(new Error(message.slice(0, 2500)));
    });
    child.stdin.end(input);
  });
}

const state = input => JSON.parse(sql(input));
const sweep = (name, limit) => state(`set role service_role; select public.${name}(${limit})`);
const bootstrap = letter => state(`set role service_role; select public.consume_public_booking_quota(
  'bootstrap','${hash(letter)}',null,null)`);
const reconcile = letter => state(`set role service_role; select public.reconcile_public_booking_intent(
  'fixture-a','${hash(letter)}',null)`);
const prepare = (letter, start) => {
  const generation = reconcile(letter).generation;
  return state(`set role service_role; select public.prepare_public_booking_intent(
    'fixture-a','${hash(letter)}','${service}','${staff}','${start}'::timestamptz,
    'Local Fixture',null,'fixture@example.invalid','en','${generation}'::uuid)`);
};
const marker = table => sql(`select last_full_sweep_at is not null from private.${table}`);

function drain(name, limit, maxCalls = 10) {
  for (let call = 1; call <= maxCalls; call += 1) {
    const result = sweep(name, limit);
    assert.notEqual(result.busy, true, `${name} must not be busy in an isolated fixture`);
    if (result.complete) return call;
  }
  assert.fail(`${name} failed to complete within the local bounded-repeat budget`);
}

test('GLOW-56 local cleanup cadence and missed-run fail-closed contract',
  { skip: !connection, timeout: 120_000 }, async () => {
    const url = new URL(connection);
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.match(url.pathname, /^\/glowflow_sandbox_test[0-9_]*$/);
    assert.ok(!url.search && !url.hash);
    assert.equal(sql("select count(*) from pg_tables where schemaname='public'"), '0');

    sql(readFileSync(new URL('tests/supabase-platform-fixture.sql', root), 'utf8'));
    sql(readFileSync(new URL('supabase/schema.sql', root), 'utf8'));
    for (const migration of readdirSync(new URL('supabase/migrations/', root))
      .filter(name => name.endsWith('.sql')).sort()) {
      try { sql(readFileSync(new URL(`supabase/migrations/${migration}`, root), 'utf8')); }
      catch (error) { throw new Error(`Migration ${migration} failed: ${error.message}`); }
    }
    sql(readFileSync(new URL('tests/schema-authorization.sql', root), 'utf8'));
    assert.equal(sql('select current_user'), 'postgres');
    for (const signature of [
      'sweep_public_booking_intents(integer)',
      'sweep_public_booking_quota_counters(integer)',
    ]) {
      assert.equal(sql(`select has_function_privilege('postgres',
        'public.${signature}','execute')`), 't',
      'the proposed postgres-owned Cron job must be able to call the sweep RPC');
    }
    sql(`insert into private.public_booking_intent_policy
      (prepared_ttl,retention_ttl,configured_at)
      values (interval '2 hours',interval '3 days',clock_timestamp());
      insert into private.public_booking_quota_policy
      (action_bucket,window_seconds,ip_limit,browser_tenant_limit,configured_at)
      values ('bootstrap',600,100,null,clock_timestamp());`);
    assert.equal(sql("select private.transition_public_booking_mode('legacy','frozen'); "
      + "select private.transition_public_booking_mode('frozen','v2')"), 'v2');

    const starts = JSON.parse(sql(`select json_agg(slot_start order by slot_start)
      from public.get_public_booking_slots('fixture-a','${service}',
        current_date + (8 - extract(dow from current_date)::integer))
      where staff_id='${staff}'`));
    assert.ok(starts.length >= 2);

    assert.throws(() => bootstrap('a'), /booking_quota_cleanup_stale/);
    assert.throws(() => prepare('a', starts[0]), /booking_intent_cleanup_stale/);
    assert.equal(sweep('sweep_public_booking_quota_counters', 100).complete, true);
    assert.equal(sweep('sweep_public_booking_intents', 50).complete, true);
    assert.equal(bootstrap('a').allowed, true);
    const first = prepare('a', starts[0]);
    assert.equal(first.state, 'prepared');

    // Three missed 30-minute cycles leave 30 minutes of margin. This is a
    // simulated clock observation, not a sleep or a hosted scheduler.
    for (const age of [30, 90]) {
      sql(`update private.public_booking_quota_cleanup_state
        set last_full_sweep_at=clock_timestamp()-interval '${age} minutes';
        update private.public_booking_intent_cleanup_state
        set last_full_sweep_at=clock_timestamp()-interval '${age} minutes'`);
      assert.equal(bootstrap(age === 30 ? 'b' : 'c').allowed, true);
      if (age === 90) {
        assert.equal(sql(`select extract(epoch from
          (last_full_sweep_at + interval '2 hours' - clock_timestamp())) < 1800
          from private.public_booking_quota_cleanup_state`), 't',
        'a 90-minute-old sweep must be in the operator warning window');
      }
    }
    const second = prepare('b', starts[1]);
    assert.equal(second.state, 'prepared');

    sql(`update private.public_booking_quota_cleanup_state
      set last_full_sweep_at=clock_timestamp()-interval '121 minutes';
      update private.public_booking_intent_cleanup_state
      set last_full_sweep_at=clock_timestamp()-interval '121 minutes'`);
    assert.throws(() => bootstrap('d'), /booking_quota_cleanup_stale/);
    assert.throws(() => prepare('c', starts[0]), /booking_intent_cleanup_stale/);
    assert.equal(sql('select count(*) from private.public_booking_intents'), '2');

    // A failed transaction must not manufacture a completed heartbeat.
    sql('begin; set role service_role; select public.sweep_public_booking_intents(1); rollback');
    assert.equal(sql(`select last_full_sweep_at < clock_timestamp()-interval '2 hours'
      from private.public_booking_intent_cleanup_state`), 't');

    sql(`insert into private.public_booking_quota_counters
      (action_bucket,scope,tenant_id,key_digest,window_start,hits,expires_at)
      values ('bootstrap','ip','00000000-0000-0000-0000-000000000000','${hash('e')}',
        now()-interval '25 hours',1,now()-interval '1 hour'),
        ('bootstrap','ip','00000000-0000-0000-0000-000000000000','${hash('f')}',
        now()-interval '25 hours',1,now()-interval '1 hour')`);
    const partialQuota = sweep('sweep_public_booking_quota_counters', 1);
    assert.equal(partialQuota.complete, false);
    assert.equal(partialQuota.removed, 1);
    assert.equal(sql(`select count(*) from private.public_booking_quota_counters
      where expires_at <= clock_timestamp()`), '1',
    'a separate single-call scheduler invocation must commit its bounded deletion');
    assert.equal(marker('public_booking_quota_cleanup_state'), 'f');
    assert.throws(() => bootstrap('0'), /booking_quota_cleanup_stale/);
    assert.ok(drain('sweep_public_booking_quota_counters', 1) <= 10);
    assert.equal(marker('public_booking_quota_cleanup_state'), 't');
    assert.equal(bootstrap('0').allowed, true);

    sql(`update private.public_booking_intents
      set requested_start=clock_timestamp()-interval '1 second'
      where id in ('${first.intent_id}','${second.intent_id}')`);
    const partialIntent = sweep('sweep_public_booking_intents', 1);
    assert.equal(partialIntent.complete, false);
    assert.equal(partialIntent.scrubbed, 1);
    assert.equal(sql(`select count(*) from private.public_booking_intents
      where id in ('${first.intent_id}','${second.intent_id}') and state='expired'
        and client_full_name is null and client_phone is null and client_email is null`), '1',
    'an incomplete single-call invocation must persist the first PII scrub');
    assert.equal(sql(`select count(*) from private.public_booking_intents
      where id in ('${first.intent_id}','${second.intent_id}') and state='prepared'`), '1');
    assert.equal(marker('public_booking_intent_cleanup_state'), 'f');
    assert.throws(() => prepare('c', starts[0]), /booking_intent_cleanup_stale/);
    assert.ok(drain('sweep_public_booking_intents', 1) <= 10);
    assert.equal(marker('public_booking_intent_cleanup_state'), 't');
    assert.equal(sql(`select count(*) from private.public_booking_intents
      where id in ('${first.intent_id}','${second.intent_id}') and state='expired'
        and client_full_name is null and client_phone is null and client_email is null`), '2');
    assert.equal(prepare('c', starts[0]).state, 'prepared',
      'fresh completed sweeps reopen new preparations');

    // The proposed pg_cron schedule calls each existing sweep once per job,
    // in a separate committed transaction. Verify the production quota batch
    // bound also makes progress across invocations without falsely refreshing
    // the full-sweep heartbeat on its first, incomplete pass.
    sql(`insert into private.public_booking_quota_counters
      (action_bucket,scope,tenant_id,key_digest,window_start,hits,expires_at)
      select 'bootstrap','ip','00000000-0000-0000-0000-000000000000',
        repeat(md5('cron-quota-' || sequence_number::text),2),
        now()-interval '25 hours',1,now()-interval '1 hour'
      from generate_series(1,1001) as sequence_number`);
    assert.equal(sql(`select count(*) from private.public_booking_quota_counters
      where expires_at <= clock_timestamp()`), '1001');
    const firstCronQuota = sweep('sweep_public_booking_quota_counters', 1000);
    assert.equal(firstCronQuota.removed, 1000);
    assert.equal(firstCronQuota.complete, false);
    assert.equal(sql(`select count(*) from private.public_booking_quota_counters
      where expires_at <= clock_timestamp()`), '1');
    assert.equal(marker('public_booking_quota_cleanup_state'), 'f');
    assert.throws(() => bootstrap('d'), /booking_quota_cleanup_stale/);
    const secondCronQuota = sweep('sweep_public_booking_quota_counters', 1000);
    assert.equal(secondCronQuota.removed, 1);
    assert.equal(secondCronQuota.complete, true);
    assert.equal(marker('public_booking_quota_cleanup_state'), 't');
    assert.equal(state('select public.sweep_public_booking_quota_counters(1000)').complete, true,
      'the postgres Cron job owner must be able to run the quota sweep itself');
    assert.equal(state('select public.sweep_public_booking_intents(100)').complete, true,
      'the postgres Cron job owner must be able to run the intent sweep itself');

    // Overlapping Cron invocations must observe the existing advisory lock and
    // leave a completed heartbeat unchanged rather than claim another sweep.
    const held = asyncSql(`begin;
      set application_name = 'glow56_cron_cleanup_hold';
      select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'glowflow:public-booking-intent-cleanup', 0));
      select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'glowflow:public-booking-quota-cleanup', 0));
      select pg_catalog.pg_sleep(3); commit;`);
    const waitForHold = async () => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (sql(`select count(*) from pg_stat_activity where datname=current_database()
          and application_name='glow56_cron_cleanup_hold' and state='active'
          and query like '%pg_sleep(3)%'`) === '1') return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Cron cleanup fixture did not hold both advisory locks');
    };
    await Promise.race([waitForHold(), held.then(() => {
      throw new Error('Cron cleanup fixture released both locks too soon');
    })]);
    const busyIntent = state('select public.sweep_public_booking_intents(100)');
    const busyQuota = state('select public.sweep_public_booking_quota_counters(1000)');
    assert.equal(busyIntent.busy, true);
    assert.equal(busyIntent.complete, false);
    assert.equal(busyQuota.busy, true);
    assert.equal(busyQuota.complete, false);
    assert.equal(marker('public_booking_intent_cleanup_state'), 't');
    assert.equal(marker('public_booking_quota_cleanup_state'), 't');
    await held;

    // The proposed monitor must derive health from both completed sweep
    // heartbeats, not from a pg_cron job's successful SQL exit or a busy
    // response. These checks exercise only the migration's database-local
    // predicate; pg_cron, pg_net, Vault, and alert delivery need later proof.
    const monitor = () => sql('select private.glow56_cleanup_monitor_ready()');
    const setMarkers = (intent, quota) => sql(`
      update private.public_booking_intent_cleanup_state
      set last_full_sweep_at=${intent} where singleton;
      update private.public_booking_quota_cleanup_state
      set last_full_sweep_at=${quota} where singleton;
    `);
    const fresh = "clock_timestamp()-interval '9 minutes'";
    const stale = "clock_timestamp()-interval '11 minutes'";
    const future = "clock_timestamp()+interval '1 minute'";
    assert.equal(sql(`select count(*) from private.public_booking_intent_cleanup_state
      where singleton`), '1');
    assert.equal(sql(`select count(*) from private.public_booking_quota_cleanup_state
      where singleton`), '1');
    assert.equal(sql(`select prosecdef from pg_proc
      where oid='private.glow56_cleanup_monitor_ready()'::regprocedure`), 'f',
    'the monitor predicate must remain SECURITY INVOKER');
    assert.equal(sql(`select proconfig @> array['search_path=""'] from pg_proc
      where oid='private.glow56_cleanup_monitor_ready()'::regprocedure`), 't',
    'the monitor predicate must use a fixed empty search_path');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(sql(`select has_function_privilege('${role}',
        'private.glow56_cleanup_monitor_ready()', 'execute')`), 'f',
      `${role} must not be able to execute the private monitor predicate`);
    }
    assert.equal(sql(`select has_function_privilege('postgres',
      'private.glow56_cleanup_monitor_ready()', 'execute')`), 't');

    setMarkers('null', 'null');
    assert.equal(monitor(), 'f', 'two missing full sweeps cannot signal health');
    setMarkers(fresh, 'null');
    assert.equal(monitor(), 'f', 'one completed sweep cannot signal health');
    setMarkers('null', fresh);
    assert.equal(monitor(), 'f', 'a partial intent sweep cannot signal health');
    setMarkers(stale, fresh);
    assert.equal(monitor(), 'f', 'an old intent sweep cannot signal health');
    setMarkers(fresh, stale);
    assert.equal(monitor(), 'f', 'an old quota sweep cannot signal health');
    setMarkers(future, fresh);
    assert.equal(monitor(), 'f', 'a future intent heartbeat cannot signal health');
    setMarkers(fresh, future);
    assert.equal(monitor(), 'f', 'a future quota heartbeat cannot signal health');
    setMarkers(fresh, fresh);
    assert.equal(monitor(), 't', 'two recent complete sweeps may signal health');
    sql('delete from private.public_booking_quota_cleanup_state where singleton');
    assert.equal(monitor(), 'f', 'a missing singleton row cannot signal health');
    assert.throws(() => sql('set role anon; select private.glow56_cleanup_monitor_ready()'),
      /permission denied/);
  });

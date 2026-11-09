import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const connection = process.env.GLOWFLOW_PAYMENT_RECORDING_TEST_DATABASE_URL;
const root = new URL("../", import.meta.url);

test("manual recording is idempotent and cannot concurrently exceed the appointment snapshot", { skip: !connection }, async () => {
  const url = new URL(connection);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/glowflow_payment_recording_test[0-9_]*$/);
  assert.ok(!url.search && !url.hash);
  const psql = process.env.PSQL_BIN || "psql";

  function sql(input) {
    const result = spawnSync(psql, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", "-d", connection], {
      input, encoding: "utf8", timeout: 60_000,
    });
    if (result.status !== 0) throw new Error((result.stderr || "Local PostgreSQL command failed.").slice(0, 3000));
    return result.stdout.trim();
  }

  function concurrentSql(input) {
    return new Promise((resolve) => {
      const child = spawn(psql, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", "-d", connection], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = ""; let stderr = "";
      child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
      child.on("close", status => resolve({ status, stdout, stderr }));
      child.stdin.end(input);
    });
  }

  sql(readFileSync(new URL("tests/supabase-platform-fixture.sql", root), "utf8"));
  sql(readFileSync(new URL("supabase/schema.sql", root), "utf8"));
  for (const migration of readdirSync(new URL("supabase/migrations/", root)).filter(name => name.endsWith(".sql")).sort()) {
    sql(readFileSync(new URL(`supabase/migrations/${migration}`, root), "utf8"));
  }

  sql(`
    insert into auth.users(id,email) values
      ('20000000-0000-0000-0000-000000000001','owner@example.invalid');
    insert into public.tenants(id,name,slug,owner_id,country_code,currency,time_zone)
    values('10000000-0000-0000-0000-000000000001','Payment fixture','payment-fixture','20000000-0000-0000-0000-000000000001','US','USD','America/New_York');
    insert into public.users(id,tenant_id,full_name,email,role)
    values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Owner','owner@example.invalid','owner');
    insert into public.clients(id,tenant_id,full_name)
    values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Client');
    insert into public.services(id,tenant_id,title_json,duration_minutes,price,deposit_amount,category,currency)
    values
      ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"fr":"Coupe","en":"Cut"}',30,5000,1000,'hair','USD'),
      ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','{"fr":"Test volume"}',30,2000000,0,'hair','USD');
    insert into public.appointments(id,tenant_id,client_id,service_id,staff_id,start_time,end_time)
    values
      ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',now()+interval '1 day',now()+interval '1 day 30 minutes'),
      ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',now()+interval '2 days',now()+interval '2 days 30 minutes');

    insert into public.payment_entries(
      tenant_id,appointment_id,entry_type,payment_method,amount,currency,idempotency_key
    )
    select
      '10000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000002',
      'payment','cash',1,'USD',gen_random_uuid()
    from generate_series(1,1001);
  `);

  const grouped = sql(`
    set role authenticated;
    set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
    select paid_amount
    from public.get_appointment_payment_summaries(
      array['50000000-0000-0000-0000-000000000002']::uuid[]
    );
  `);
  assert.match(grouped, /(?:^|\r?\n)1001(?:\r?\n|$)/,
    "grouped summary must include ledger rows beyond the Data API row limit");

  const payment = (amount, key) => `
    begin;
    set local role authenticated;
    set local request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
    select public.record_manual_appointment_payment(
      '50000000-0000-0000-0000-000000000001','cash',${amount},'${key}'
    );
    select pg_sleep(1);
    commit;
  `;

  const bounded = await Promise.all([
    concurrentSql(payment(3000, "66000000-0000-0000-0000-000000000001")),
    concurrentSql(payment(3000, "66000000-0000-0000-0000-000000000002")),
  ]);
  assert.equal(bounded.filter(result => result.status === 0).length, 1);
  assert.match(bounded.find(result => result.status !== 0)?.stderr ?? "", /payment_exceeds_outstanding_balance/);
  assert.equal(sql("select sum(amount) from public.payment_entries where appointment_id='50000000-0000-0000-0000-000000000001'"), "3000");

  const duplicate = await Promise.all([
    concurrentSql(payment(1000, "66000000-0000-0000-0000-000000000003")),
    concurrentSql(payment(1000, "66000000-0000-0000-0000-000000000003")),
  ]);
  assert.equal(duplicate.filter(result => result.status === 0).length, 2);
  assert.equal(sql("select count(*) from public.payment_entries where idempotency_key='66000000-0000-0000-0000-000000000003'"), "1");
  assert.equal(sql("select net_paid_amount from public.get_appointment_payment_summary('50000000-0000-0000-0000-000000000001')"), "4000");

  const card = sql(`
    set role authenticated;
    set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
    select public.record_manual_appointment_payment(
      '50000000-0000-0000-0000-000000000001',
      'external_card', 1000, '66000000-0000-0000-0000-000000000004'
    );
  `).split("\n").at(-1);
  assert.match(card, /^[0-9a-f-]{36}$/);
  assert.equal(sql(`
    select string_agg(payment_method || ':' || amount, ',' order by payment_method, amount)
    from public.payment_entries
    where appointment_id='50000000-0000-0000-0000-000000000001'
  `), "cash:1000,cash:3000,external_card:1000");
  assert.equal(sql("select net_paid_amount from public.get_appointment_payment_summary('50000000-0000-0000-0000-000000000001')"), "5000");

  sql(`
    set role authenticated;
    set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
    select public.cancel_calendar_appointment('50000000-0000-0000-0000-000000000001');
  `);
  assert.equal(sql("select status from public.appointments where id='50000000-0000-0000-0000-000000000001'"), "canceled");
  assert.equal(sql("select net_paid_amount from public.get_appointment_payment_summary('50000000-0000-0000-0000-000000000001')"), "5000",
    "canceling an appointment must not silently erase or refund its payment ledger");
  assert.equal(sql("select count(*) from public.payment_entries where appointment_id='50000000-0000-0000-0000-000000000001' and entry_type='refund'"), "0");
  assert.throws(() => sql(`
    set role authenticated;
    set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
    select public.cancel_calendar_appointment('50000000-0000-0000-0000-000000000001');
  `), /appointment_not_cancelable/);

  // A previously settled provider deposit must reduce the balance collected
  // at the salon. This exercises the full-schema ledger and owner RPC, not a
  // live Stripe charge or a client-facing checkout screen.
  sql(`
    update public.tenants set stripe_account_id='acct_fixture'
    where id='10000000-0000-0000-0000-000000000001';
    insert into public.appointments(id,tenant_id,client_id,service_id,staff_id,start_time,end_time)
    values(
      '50000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      now()+interval '3 days',now()+interval '3 days 30 minutes'
    );
  `);
  assert.equal(sql(`select service_deposit_amount from public.appointments
    where id='50000000-0000-0000-0000-000000000003'`), '1000');
  assert.throws(() => sql(`
    set role service_role;
    insert into public.payment_entries(
      tenant_id,appointment_id,entry_type,payment_method,amount,currency,
      provider_account_id,provider_payment_id,idempotency_key
    ) values(
      '10000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000003',
      'payment','stripe',1000,'USD','acct_other','pi_fixture_deposit',
      '66000000-0000-0000-0000-000000000005'
    );
  `), /payment_provider_account_mismatch/);
  sql(`
    set role service_role;
    insert into public.payment_entries(
      tenant_id,appointment_id,entry_type,payment_method,amount,currency,
      provider_account_id,provider_payment_id,idempotency_key
    ) values(
      '10000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000003',
      'payment','stripe',1000,'USD','acct_fixture','pi_fixture_deposit',
      '66000000-0000-0000-0000-000000000005'
    );
  `);
  assert.equal(sql(`select net_paid_amount from public.get_appointment_payment_summary(
    '50000000-0000-0000-0000-000000000003')`), '1000');

  const splitPayment = (method, amount, key) => sql(`
    set role authenticated;
    set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
    select public.record_manual_appointment_payment(
      '50000000-0000-0000-0000-000000000003',
      '${method}',${amount},'${key}'
    );
  `).split('\n').at(-1);
  const cashKey = '66000000-0000-0000-0000-000000000006';
  const cardKey = '66000000-0000-0000-0000-000000000007';
  const cashEntry = splitPayment('cash', 2500, cashKey);
  assert.equal(splitPayment('cash', 2500, cashKey), cashEntry,
    'an unchanged cash retry must not collect twice');
  assert.throws(() => splitPayment('external_card', 1501, cardKey),
    /payment_exceeds_outstanding_balance/);
  assert.match(splitPayment('external_card', 1500, cardKey), /^[0-9a-f-]{36}$/);
  assert.equal(sql(`select string_agg(payment_method || ':' || amount, ',' order by payment_method)
    from public.payment_entries
    where appointment_id='50000000-0000-0000-0000-000000000003'`),
  'cash:2500,external_card:1500,stripe:1000');
  assert.equal(sql(`select net_paid_amount from public.get_appointment_payment_summary(
    '50000000-0000-0000-0000-000000000003')`), '5000');
  assert.throws(() => splitPayment('cash', 1, '66000000-0000-0000-0000-000000000008'),
    /payment_exceeds_outstanding_balance/);

  sql(`
    set role authenticated;
    set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
    select public.cancel_calendar_appointment('50000000-0000-0000-0000-000000000003');
  `);
  assert.equal(sql(`select net_paid_amount from public.get_appointment_payment_summary(
    '50000000-0000-0000-0000-000000000003')`), '5000',
  'cancellation must not manufacture a provider refund');
  assert.equal(sql(`select count(*) from public.payment_entries
    where appointment_id='50000000-0000-0000-0000-000000000003'
      and entry_type='refund'`), '0');
});

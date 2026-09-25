import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const connection = process.env.GLOWFLOW_SANDBOX_TEST_DATABASE_URL;
const root = new URL('../', import.meta.url);

test('fresh baseline and all migrations preserve core tenant authorization', { skip: !connection }, async () => {
  const url = new URL(connection);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /^\/glowflow_sandbox_test[0-9_]*$/);
  assert.ok(!url.search && !url.hash);
  function sql(input) {
    const result = spawnSync(process.env.PSQL_BIN || 'psql', ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-At', '-d', connection], {
      input, encoding: 'utf8', timeout: 60_000,
    });
    if (result.status !== 0) {
      let message = result.stderr || 'Local PostgreSQL command failed.';
      for (const value of [connection, url.password, decodeURIComponent(url.password)]) {
        if (value) message = message.replaceAll(value, '[redacted]');
      }
      throw new Error(message.slice(0, 3000));
    }
    return result.stdout.trim();
  }
  assert.equal(sql("select count(*) from pg_tables where schemaname='public'"), '0');
  sql(readFileSync(new URL('tests/supabase-platform-fixture.sql', root), 'utf8'));
  sql(readFileSync(new URL('supabase/schema.sql', root), 'utf8'));
  for (const migration of readdirSync(new URL('supabase/migrations/', root)).filter(name => name.endsWith('.sql')).sort()) {
    try { sql(readFileSync(new URL(`supabase/migrations/${migration}`, root), 'utf8')); }
    catch (error) { throw new Error(`Migration ${migration} failed: ${error.message}`); }
  }
  const unprotected = sql("select string_agg(c.relname, ',') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity");
  assert.equal(unprotected, '', 'every public table must have runtime RLS enabled');
  // Test the actual migrated application objects, never recreated policy fixtures.
  sql(readFileSync(new URL('tests/schema-authorization.sql', root), 'utf8'));

  function concurrentSql(input) {
    return new Promise((resolve) => {
      const child = spawn(process.env.PSQL_BIN || 'psql', ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-At', '-d', connection], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
      child.on('close', status => resolve({ status, stdout, stderr }));
      child.stdin.end(input);
    });
  }

  const refund = idempotencyKey => `
    begin;
    insert into public.payment_entries(
      tenant_id,appointment_id,entry_type,payment_method,amount,currency,idempotency_key
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001',
      'refund','cash',1000,'USD','${idempotencyKey}'
    );
    select pg_sleep(1);
    commit;
  `;
  const concurrentRefunds = await Promise.all([
    concurrentSql(refund('66000000-0000-0000-0000-000000000020')),
    concurrentSql(refund('66000000-0000-0000-0000-000000000021')),
  ]);
  assert.equal(concurrentRefunds.filter(result => result.status === 0).length, 1,
    'only one concurrent refund may commit');
  const rejectedRefund = concurrentRefunds.find(result => result.status !== 0);
  assert.ok(rejectedRefund, 'one concurrent refund must be rejected');
  assert.match(rejectedRefund.stderr, /refund_exceeds_paid_amount/);
  assert.equal(sql("select count(*) from public.payment_entries where entry_type='refund' and idempotency_key in ('66000000-0000-0000-0000-000000000020','66000000-0000-0000-0000-000000000021')"), '1');
});

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
  const unprotectedTenantTables = sql(`
    select string_agg(format('%I.%I', n.nspname, c.relname), ',' order by n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'private') and not c.relrowsecurity
  `);
  assert.equal(unprotectedTenantTables, '', 'every tenant-owned table in application schemas must have runtime RLS enabled');
  // Test the actual migrated application objects, never recreated policy fixtures.
  sql(readFileSync(new URL('tests/schema-authorization.sql', root), 'utf8'));
  sql(readFileSync(new URL('tests/client-directory-authorization.sql', root), 'utf8'));
  sql(readFileSync(new URL('tests/nail-preferences-authorization.sql', root), 'utf8'));
  sql(readFileSync(new URL('tests/product-catalog-authorization.sql', root), 'utf8'));
  sql(readFileSync(new URL('tests/public-booking-service-staff.sql', root), 'utf8'));
  sql(readFileSync(new URL('tests/public-booking-slot-integrity.sql', root), 'utf8'));
  sql(readFileSync(new URL('tests/public-salon-distance.sql', root), 'utf8'));
  sql(readFileSync(new URL('tests/staff-invitation-authorization.sql', root), 'utf8'));
  sql(readFileSync(new URL('tests/staff-invitation-issuer-authorization.sql', root), 'utf8'));
  sql(readFileSync(new URL('tests/staff-invitation-delivery-authorization.sql', root), 'utf8'));

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

  const concurrentIssuerAttempt = `
    begin;
    set local request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
    select length(raw_token) from private.prepare_staff_invitation('concurrent.issuer@example.invalid');
    select pg_sleep(0.25);
    commit;
  `;
  const concurrentIssuers = await Promise.all([
    concurrentSql(concurrentIssuerAttempt),
    concurrentSql(concurrentIssuerAttempt),
  ]);
  assert.equal(concurrentIssuers.filter(result => result.status === 0).length, 2,
    'both serialized issuer calls must commit');
  assert.equal(sql(`select count(*) from private.staff_invitations
    where tenant_id='10000000-0000-0000-0000-000000000001'
      and email_normalized='concurrent.issuer@example.invalid'`), '2');
  assert.equal(sql(`select count(*) from private.staff_invitations
    where tenant_id='10000000-0000-0000-0000-000000000001'
      and email_normalized='concurrent.issuer@example.invalid'
      and accepted_at is null and revoked_at is null`), '1',
    'concurrent preparations leave one active token');

  const invitationAttempt = `
    begin;
    set local role authenticated;
    set local request.jwt.claim.sub = '20000000-0000-0000-0000-000000000093';
    select public.accept_staff_invitation(repeat('C',43), 'Second Staff', 'en');
    select pg_sleep(1);
    commit;
  `;
  const concurrentInvitations = await Promise.all([
    concurrentSql(invitationAttempt),
    concurrentSql(invitationAttempt),
  ]);
  assert.equal(concurrentInvitations.filter(result => result.status === 0).length, 1,
    'only one concurrent redemption of a single invitation may commit');
  const rejectedInvitation = concurrentInvitations.find(result => result.status !== 0);
  assert.ok(rejectedInvitation);
  assert.match(rejectedInvitation.stderr, /staff_invitation_unavailable/);
  assert.equal(sql("select count(*) from public.users where id='20000000-0000-0000-0000-000000000093' and tenant_id='10000000-0000-0000-0000-000000000001' and role='staff'"), '1');
  assert.equal(sql("select count(*) from private.staff_invitations where token_hash=sha256(convert_to(repeat('C',43),'UTF8')) and accepted_by='20000000-0000-0000-0000-000000000093'"), '1');

  const differentTokenAttempt = token => `
    begin;
    set local role authenticated;
    set local request.jwt.claim.sub = '20000000-0000-0000-0000-000000000094';
    select public.accept_staff_invitation(repeat('${token}',43), 'Dual Staff', 'fr');
    select pg_sleep(1);
    commit;
  `;
  const differentInvitations = await Promise.all([
    concurrentSql(differentTokenAttempt('J')),
    concurrentSql(differentTokenAttempt('K')),
  ]);
  assert.equal(differentInvitations.filter(result => result.status === 0).length, 1,
    'two valid invitations for one Auth identity cannot create two salon memberships');
  assert.match(differentInvitations.find(result => result.status !== 0)?.stderr ?? '',
    /staff_invitation_unavailable/);
  assert.equal(sql("select count(*) from public.users where id='20000000-0000-0000-0000-000000000094' and role='staff'"), '1');
  assert.equal(sql("select count(*) from private.staff_invitations where token_hash in (sha256(convert_to(repeat('J',43),'UTF8')),sha256(convert_to(repeat('K',43),'UTF8'))) and accepted_at is not null"), '1',
    'only the winning invitation is consumed');
  assert.equal(sql("select count(*) from private.staff_invitations where token_hash in (sha256(convert_to(repeat('J',43),'UTF8')),sha256(convert_to(repeat('K',43),'UTF8'))) and accepted_at is null"), '1',
    'the losing invitation remains unconsumed');
  assert.equal(sql("select count(*) from private.staff_invitations as invitation join public.users as member on member.id=invitation.accepted_by and member.tenant_id=invitation.tenant_id where member.id='20000000-0000-0000-0000-000000000094'"), '1',
    'winning invitation and membership identify the same salon');

  // Freeze a transaction before expiry, then make it wait on the invitation
  // row until after expiry. Transaction-start now() would incorrectly accept.
  sql(`insert into private.staff_invitations
    (tenant_id,inviter_id,email_normalized,token_hash,expires_at)
    values ('10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001','delayed.staff@example.invalid',
      sha256(convert_to(repeat('L',43),'UTF8')),
      clock_timestamp()+interval '8 seconds')`);
  const holder = spawn(process.env.PSQL_BIN || 'psql',
    ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-At', '-d', connection],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  let holderOut = '';
  let holderErr = '';
  let readyResolve;
  let readyReject;
  const lockReady = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const holderDone = new Promise(resolve => {
    holder.stdout.setEncoding('utf8').on('data', chunk => {
      holderOut += chunk;
      if (holderOut.includes('LOCK_READY')) readyResolve();
    });
    holder.stderr.setEncoding('utf8').on('data', chunk => { holderErr += chunk; });
    holder.on('error', error => readyReject(error));
    holder.on('close', status => {
      if (!holderOut.includes('LOCK_READY')) readyReject(new Error(holderErr || 'invitation lock was not acquired'));
      resolve({ status, stderr: holderErr });
    });
  });
  holder.stdin.end(`
    begin;
    select 'LOCK_READY' from private.staff_invitations
      where token_hash=sha256(convert_to(repeat('L',43),'UTF8')) for update;
    select pg_sleep(9);
    commit;
  `);
  await lockReady;
  const delayedAttempt = concurrentSql(`
    begin;
    select 'BEFORE_EXPIRY' from private.staff_invitations
      where token_hash=sha256(convert_to(repeat('L',43),'UTF8'))
        and clock_timestamp() < expires_at;
    set local role authenticated;
    set local request.jwt.claim.sub = '20000000-0000-0000-0000-000000000095';
    select public.accept_staff_invitation(repeat('L',43), 'Delayed Staff', 'en');
    commit;
  `);
  const [heldLock, delayed] = await Promise.all([holderDone, delayedAttempt]);
  assert.equal(heldLock.status, 0, heldLock.stderr);
  assert.match(delayed.stdout, /BEFORE_EXPIRY/,
    'recipient transaction started before invitation expiry');
  assert.notEqual(delayed.status, 0, 'lock-delayed redemption after expiry must fail');
  assert.match(delayed.stderr, /staff_invitation_unavailable/);
  assert.equal(sql("select count(*) from public.users where id='20000000-0000-0000-0000-000000000095'"), '0');
  assert.equal(sql("select count(*) from private.staff_invitations where token_hash=sha256(convert_to(repeat('L',43),'UTF8')) and accepted_at is null"), '1');

  sql(readFileSync(new URL('supabase/rollbacks/20261103172555_disable_verified_staff_invitation_acceptance.sql', root), 'utf8'));
  assert.equal(sql("select has_function_privilege('authenticated','public.accept_staff_invitation(text,text,text)','execute')"), 'f',
    'fail-closed rollback disables acceptance');
  assert.equal(sql("select count(*) from public.users where id='20000000-0000-0000-0000-000000000093'"), '1',
    'rollback preserves accepted membership and invitation history');
  sql(readFileSync(new URL('supabase/rollbacks/20261103214314_disable_staff_invitation_preparation.sql', root), 'utf8'));
  assert.equal(sql("select to_regprocedure('private.prepare_staff_invitation(text)') is null"), 't',
    'issuer rollback removes only the inactive preparation function');
  assert.equal(sql("select count(*) from private.staff_invitations where email_normalized='issuer@example.invalid'"), '3',
    'issuer rollback preserves the audit rows across both salons');
  sql(readFileSync(new URL('supabase/rollbacks/20261104004728_disable_staff_invitation_delivery.sql', root), 'utf8'));
  assert.equal(sql("select has_function_privilege('service_role','public.enqueue_staff_invitation_delivery(uuid,text,uuid,text)','execute')"), 'f',
    'delivery rollback disables new enqueue calls without erasing audit rows');

  const duplicateBooking = (startTime, holdSeconds) => `
    begin;
    set local role service_role;
    select appointment_id from public.create_public_appointment(
      'fixture-a',
      '40000000-0000-0000-0000-000000000005',
      '20000000-0000-0000-0000-000000000005',
      (current_date + (8 - extract(dow from current_date)::integer) + time '${startTime}')
        at time zone 'America/New_York',
      'Concurrent Retry Fixture',
      null,
      'concurrent-retry@example.invalid',
      'en',
      '70000000-0000-0000-0000-000000000015'
    );
    select pg_sleep(${holdSeconds});
    commit;
  `;
  const concurrentBookings = await Promise.all([
    concurrentSql(duplicateBooking('12:00', 1)),
    // A drifted retry proves serialization is keyed by request key, not start.
    concurrentSql(duplicateBooking('12:30', 0)),
  ]);
  assert.equal(concurrentBookings.filter(result => result.status === 0).length, 2,
    'concurrent duplicate booking requests must both return successfully');
  const returnedAppointmentIds = concurrentBookings.map(result => {
    const match = result.stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    assert.ok(match, `concurrent booking did not return an appointment id: ${result.stderr}`);
    return match[0];
  });
  assert.equal(returnedAppointmentIds[0], returnedAppointmentIds[1],
    'concurrent duplicate booking requests must converge on one appointment');
  assert.equal(sql("select count(*) from public.appointments where public_booking_request_key='70000000-0000-0000-0000-000000000015'"), '1');
  assert.equal(sql("select count(*) from public.clients where email='concurrent-retry@example.invalid'"), '1');

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

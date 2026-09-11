import assert from 'node:assert/strict';

// Assertions execute against tables/policies created by the two real sandbox migrations.
export function verifySandboxAuthorization(sql, reservation) {
  const tenant = reservation.tenant_id;
  const owner = '20000000-0000-0000-0000-000000000001';
  const staff = '20000000-0000-0000-0000-000000000002';
  const otherTenant = '10000000-0000-0000-0000-000000000002';
  const otherOwner = '20000000-0000-0000-0000-000000000003';
  const otherService = '30000000-0000-0000-0000-000000000002';
  const tables = ['stripe_sandbox_connections', 'stripe_sandbox_reservations', 'stripe_sandbox_events'];
  function asUser(uid, query) {
    return sql(`set role authenticated;set request.jwt.claim.sub='${uid}';${query}`).split('\n').at(-1);
  }
  sql(`insert into public.tenants select '${otherTenant}','${otherOwner}','second-fixture',name,country_code,currency,time_zone,is_booking_enabled from public.tenants where id='${tenant}';
    insert into public.users values('${otherOwner}','${otherTenant}');
    insert into public.services select '${otherService}','${otherTenant}',title_json,duration_minutes,sanitation_buffer_minutes,station_name,deposit_amount,currency,is_active from public.services where id='${reservation.service_id}';
    insert into public.stripe_sandbox_connections(tenant_id,stripe_account_id) values('${otherTenant}','acct_otherfixture');
    insert into public.stripe_sandbox_reservations(tenant_id,service_id,staff_id,request_key,start_time,end_time,buffer_end_time,station_name,locale,client_full_name,stripe_account_id,amount,currency,service_title)
    select '${otherTenant}','${otherService}','${otherOwner}',request_key,start_time,end_time,buffer_end_time,station_name,locale,'Second tenant private client','acct_otherfixture',amount,currency,service_title from public.stripe_sandbox_reservations where id='${reservation.id}'`);
  for (const table of tables) {
    assert.equal(sql(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`), 't', `${table} must enable RLS`);
    assert.throws(() => sql(`set role anon;select * from public.${table}`), /permission denied/, `anonymous cannot read ${table}`);
    for (const uid of [owner, staff, otherOwner]) {
      assert.throws(() => asUser(uid, `delete from public.${table}`), /permission denied/, `${uid} cannot delete ${table}`);
    }
  }
  for (const table of ['stripe_sandbox_connections', 'stripe_sandbox_reservations']) {
    assert.ok(Number(asUser(owner, `select count(*) from public.${table} where tenant_id='${tenant}'`)) > 0);
    assert.equal(asUser(owner, `select count(*) from public.${table} where tenant_id='${otherTenant}'`), '0');
    assert.equal(asUser(otherOwner, `select count(*) from public.${table} where tenant_id='${tenant}'`), '0');
    assert.equal(asUser(otherOwner, `select count(*) from public.${table} where tenant_id='${otherTenant}'`), '1');
    assert.equal(asUser(staff, `select count(*) from public.${table}`), '0');
    assert.equal(asUser('20000000-0000-0000-0000-000000000099', `select count(*) from public.${table}`), '0');
    assert.throws(() => asUser(owner, `update public.${table} set tenant_id='${otherTenant}' where tenant_id='${tenant}'`), /permission denied/);
    assert.throws(() => asUser(otherOwner, `update public.${table} set tenant_id='${otherTenant}' where tenant_id='${tenant}'`), /permission denied/);
  }
  for (const uid of [owner, staff, otherOwner]) {
    assert.throws(() => asUser(uid, 'select * from public.stripe_sandbox_events'), /permission denied/);
    assert.throws(() => asUser(uid, "update public.stripe_sandbox_events set event_id='evt_forbidden'"), /permission denied/);
    for (const table of tables) {
      assert.throws(() => asUser(uid, `insert into public.${table} default values`), /permission denied/);
    }
  }
  for (const table of tables) {
    assert.throws(() => sql(`set role anon;delete from public.${table}`), /permission denied/);
    assert.throws(() => sql(`set role anon;insert into public.${table} default values`), /permission denied/);
  }
  assert.throws(() => asUser(owner, `insert into public.stripe_sandbox_connections(tenant_id) values('${tenant}')`), /permission denied/);
  // Explicit function ACL tests catch PUBLIC grants even if RLS remains enabled.
  const calls = [
    `public.reserve_stripe_sandbox_booking('fixture','${reservation.service_id}','${owner}',now()+interval '10 days','Test Client',null,'test@example.com','fr',gen_random_uuid())`,
    `public.attach_stripe_sandbox_checkout('${reservation.id}','cs_test_fixture','https://checkout.stripe.com/c/pay/fixture')`,
    `public.process_stripe_sandbox_event('evt_denied','acct_fixture','${reservation.id}','cs_test_fixture','pi_fixture','checkout.session.completed',1200,'EUR','${tenant}','${reservation.appointment_id}','${reservation.client_id}',false)`,
  ];
  for (const call of calls) {
    assert.throws(() => sql(`set role anon;select ${call}`), /permission denied for function/);
    for (const uid of [owner, staff, otherOwner]) assert.throws(() => asUser(uid, `select ${call}`), /permission denied for function/);
  }
  const grants = JSON.parse(sql(`select json_agg(json_build_object('name',p.proname,'service',has_function_privilege('service_role',p.oid,'execute'),'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'fixed_search_path',p.proconfig @> array['search_path=""'])) from pg_proc p where p.proname in ('reserve_stripe_sandbox_booking','attach_stripe_sandbox_checkout','process_stripe_sandbox_event')`));
  assert.equal(grants.length, 3);
  for (const grant of grants) assert.deepEqual([grant.service, grant.anon, grant.authenticated, grant.fixed_search_path], [true, false, false, true], grant.name);
}

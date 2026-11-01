-- The app's client profile fields remain tenant-private under the real migrated RLS.
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select public.test_assert(
  (select count(*) from public.clients where tenant_id='10000000-0000-0000-0000-000000000001' and notes='private notes') = 1,
  'staff can read own client notes'
);
update public.clients
set hair_formulas='[{"service_date":"2030-06-01","formula":"synthetic shade A","staff_id":"20000000-0000-0000-0000-000000000002"}]'::jsonb,
  patch_test_history='[{"test_date":"2030-05-30","result":"synthetic clear","staff_id":"20000000-0000-0000-0000-000000000002"}]'::jsonb
where tenant_id='10000000-0000-0000-0000-000000000001'
  and id='30000000-0000-0000-0000-000000000001';
select public.test_assert(
  (select count(*) from public.clients
    where id='30000000-0000-0000-0000-000000000001'
      and hair_formulas @> '[{"formula":"synthetic shade A"}]'::jsonb
      and patch_test_history @> '[{"result":"synthetic clear"}]'::jsonb) = 1,
  'staff can read own salon hair formula and patch-test history'
);
select public.test_rejected(
  $sql$update public.clients set hair_formulas='{}'::jsonb
    where id='30000000-0000-0000-0000-000000000001'$sql$,
  '23514'
);
select public.test_rejected(
  $sql$update public.clients set patch_test_history='{}'::jsonb
    where id='30000000-0000-0000-0000-000000000001'$sql$,
  '23514'
);
select public.test_assert(
  (select count(*) from public.clients
    where id='30000000-0000-0000-0000-000000000001'
      and hair_formulas @> '[{"formula":"synthetic shade A"}]'::jsonb
      and patch_test_history @> '[{"result":"synthetic clear"}]'::jsonb) = 1,
  'rejected hair history shapes leave the prior records intact'
);
select public.test_assert(
  (select count(*) from public.appointments where tenant_id='10000000-0000-0000-0000-000000000002') = 0,
  'staff cannot read other salon appointment history'
);
insert into public.clients(tenant_id,full_name,email,phone,notes,preferred_locale)
values ('10000000-0000-0000-0000-000000000001','Synthetic Staff Client','staff-client@example.invalid','+1 555 010 1234','Synthetic note','es');
update public.clients set email='updated@example.invalid', phone='+1 555 010 5678',
  notes='Updated synthetic note', preferred_locale='en'
where tenant_id='10000000-0000-0000-0000-000000000001' and full_name='Synthetic Staff Client';
select public.test_assert(
  (select count(*) from public.clients where full_name='Synthetic Staff Client'
    and email='updated@example.invalid' and phone='+1 555 010 5678'
    and notes='Updated synthetic note' and preferred_locale='en') = 1,
  'staff can update own salon client contact, notes, and language'
);
do $$
declare changed integer;
begin
  update public.clients set notes='forbidden',
    hair_formulas='[{"formula":"forbidden"}]'::jsonb,
    patch_test_history='[{"result":"forbidden"}]'::jsonb
  where tenant_id='10000000-0000-0000-0000-000000000002';
  get diagnostics changed = row_count;
  perform public.test_assert(changed = 0, 'staff foreign client and hair record update affects zero rows');
end $$;
select public.test_assert(
  (select count(*) from public.clients where tenant_id='10000000-0000-0000-0000-000000000002') = 0,
  'staff cannot see or update foreign salon client'
);
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
select public.test_assert(
  (select count(*) from public.clients where email='updated@example.invalid') = 0,
  'foreign owner cannot find staff-created client by email'
);
select public.test_assert(
  (select count(*) from public.clients
    where hair_formulas @> '[{"formula":"synthetic shade A"}]'::jsonb
      or patch_test_history @> '[{"result":"synthetic clear"}]'::jsonb) = 0,
  'foreign owner cannot read another salon hair or patch-test records'
);
select public.test_denied(
  'insert into public.clients(tenant_id,full_name) values(''10000000-0000-0000-0000-000000000001'',''Foreign client'')'
);
reset role;
select public.test_assert(
  (select count(*) from public.clients where tenant_id='10000000-0000-0000-0000-000000000002'
    and notes='private notes' and hair_formulas='[]'::jsonb and patch_test_history='[]'::jsonb) = 1,
  'foreign client sensitive records remain unchanged after denied staff update'
);
set role anon;
select public.test_denied('select email,phone,notes,preferred_locale from public.clients');
select public.test_denied('select hair_formulas,patch_test_history from public.clients');
select public.test_denied('insert into public.clients(tenant_id,full_name) values(''10000000-0000-0000-0000-000000000001'',''Anonymous client'')');
reset role;

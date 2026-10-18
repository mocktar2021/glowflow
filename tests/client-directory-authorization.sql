-- The app's client profile fields remain tenant-private under the real migrated RLS.
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select public.test_assert(
  (select count(*) from public.clients where tenant_id='10000000-0000-0000-0000-000000000001' and notes='private notes') = 1,
  'staff can read own client notes'
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
  update public.clients set notes='forbidden' where tenant_id='10000000-0000-0000-0000-000000000002';
  get diagnostics changed = row_count;
  perform public.test_assert(changed = 0, 'staff foreign client update affects zero rows');
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
select public.test_denied(
  'insert into public.clients(tenant_id,full_name) values(''10000000-0000-0000-0000-000000000001'',''Foreign client'')'
);
reset role;
select public.test_assert(
  (select count(*) from public.clients where tenant_id='10000000-0000-0000-0000-000000000002' and notes='private notes') = 1,
  'foreign client note remains unchanged after denied staff update'
);
set role anon;
select public.test_denied('select email,phone,notes,preferred_locale from public.clients');
select public.test_denied('insert into public.clients(tenant_id,full_name) values(''10000000-0000-0000-0000-000000000001'',''Anonymous client'')');
reset role;

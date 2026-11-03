-- GLOW-9 synthetic, local-only acceptance cases. Schema and migrations are loaded first.
reset role;
reset request.jwt.claim.sub;

insert into auth.users (id, email, email_confirmed_at) values
  ('20000000-0000-0000-0000-000000000090', 'New.Staff@Example.Invalid', now()),
  ('20000000-0000-0000-0000-000000000091', 'unverified@example.invalid', null),
  ('20000000-0000-0000-0000-000000000092', 'wrong@example.invalid', now()),
  ('20000000-0000-0000-0000-000000000093', 'second.staff@example.invalid', now());
update auth.users set email_confirmed_at = now()
where id = '20000000-0000-0000-0000-000000000002';

insert into private.staff_invitations
  (tenant_id, inviter_id, email_normalized, token_hash, created_at, expires_at, revoked_at)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'new.staff@example.invalid', sha256(convert_to(repeat('F', 43), 'UTF8')), now(), now() + interval '1 day', null),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'unverified@example.invalid', sha256(convert_to(repeat('U', 43), 'UTF8')), now(), now() + interval '1 day', null),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'other@example.invalid', sha256(convert_to(repeat('M', 43), 'UTF8')), now(), now() + interval '1 day', null),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'new.staff@example.invalid', sha256(convert_to(repeat('E', 43), 'UTF8')),
   now() - interval '2 days', now() - interval '1 day', null),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'new.staff@example.invalid', sha256(convert_to(repeat('R', 43), 'UTF8')),
   now(), now() + interval '1 day', now()),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003',
   'staff-a@example.invalid', sha256(convert_to(repeat('S', 43), 'UTF8')), now(), now() + interval '1 day', null),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'second.staff@example.invalid', sha256(convert_to(repeat('C', 43), 'UTF8')), now(), now() + interval '1 day', null);

select public.test_assert(
  (select count(*) from information_schema.columns
   where table_schema = 'private' and table_name = 'staff_invitations'
     and column_name like '%token%') = 1,
  'invitation stores only a token hash, not the plaintext token'
);
select public.test_assert(
  (select count(*) from private.staff_invitations where octet_length(token_hash) = 32) = 7,
  'all stored token digests are SHA-256'
);
select public.test_assert(
  (select relrowsecurity from pg_class where oid = 'private.staff_invitations'::regclass),
  'private tenant-owned invitation table has RLS'
);
select public.test_assert(
  not has_table_privilege('anon', 'private.staff_invitations', 'select')
  and not has_table_privilege('authenticated', 'private.staff_invitations', 'select')
  and not has_table_privilege('service_role', 'private.staff_invitations', 'insert'),
  'client roles and service role have no direct invitation-table grants'
);

set role anon;
select public.test_denied('select * from private.staff_invitations');
select public.test_denied(
  'select public.accept_staff_invitation(repeat(''F'',43),''Anon Person'',''fr'')'
);
reset role;

set role authenticated;
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
select public.test_denied(
  'insert into public.users(id,tenant_id,full_name,email,role) values
   (''20000000-0000-0000-0000-000000000090'',
    ''10000000-0000-0000-0000-000000000001'',
    ''Unaccepted Person'', ''new.staff@example.invalid'', ''staff'')'
);

set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000091';
select public.test_rejected(
  'select public.accept_staff_invitation(repeat(''U'',43),''Unverified Person'',''fr'')',
  '22023'
);
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000092';
select public.test_rejected(
  'select public.accept_staff_invitation(repeat(''M'',43),''Wrong Email'',''fr'')',
  '22023'
);
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000002';
select public.test_rejected(
  'select public.accept_staff_invitation(repeat(''S'',43),''Existing Staff'',''fr'')',
  '22023'
);
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000090';
select public.test_rejected(
  'select public.accept_staff_invitation(repeat(''Z'',43),''Unknown Token'',''fr'')',
  '22023'
);
select public.test_rejected(
  'select public.accept_staff_invitation(repeat(''E'',43),''Expired Token'',''fr'')',
  '22023'
);
select public.test_rejected(
  'select public.accept_staff_invitation(repeat(''R'',43),''Revoked Token'',''fr'')',
  '22023'
);
select public.test_rejected(
  'select public.accept_staff_invitation(repeat(''F'',43),''N'',''fr'')',
  '22023'
);
select public.test_assert(
  public.accept_staff_invitation(repeat('F',43), 'New Staff', 'es')
  = '10000000-0000-0000-0000-000000000001'::uuid,
  'verified recipient accepts only the intended salon'
);
select public.test_assert(
  (select count(*) from public.users
   where id = '20000000-0000-0000-0000-000000000090'
     and tenant_id = '10000000-0000-0000-0000-000000000001'
     and role = 'staff' and locale = 'es'
     and email = 'new.staff@example.invalid') = 1,
  'membership binds verified Auth identity and normalized email'
);
select public.test_rejected(
  'select public.accept_staff_invitation(repeat(''F'',43),''Replay Person'',''fr'')',
  '22023'
);
reset role;
select public.test_assert(
  (select count(*) from private.staff_invitations
   where token_hash = sha256(convert_to(repeat('F',43),'UTF8'))
     and accepted_by = '20000000-0000-0000-0000-000000000090'
     and accepted_at is not null) = 1,
  'single-use acceptance records recipient and time'
);
select public.test_assert(
  (select count(*) from public.users
   where id = '20000000-0000-0000-0000-000000000091') = 0,
  'unverified recipient gained no membership'
);
insert into private.staff_invitations
  (tenant_id, inviter_id, email_normalized, token_hash, expires_at)
values
  ('10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   'new.staff@example.invalid', sha256(convert_to(repeat('T',43),'UTF8')),
   now() + interval '1 day');
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000090';
select public.test_rejected(
  'select public.accept_staff_invitation(repeat(''T'',43),''Existing Member'',''fr'')',
  '22023'
);
reset role;
select public.test_assert(
  (select count(*) from public.users
   where id = '20000000-0000-0000-0000-000000000090') = 1,
  'same-salon re-invitation cannot create or move membership'
);
select public.test_assert(
  (select count(*) from private.staff_invitations
   where token_hash = sha256(convert_to(repeat('T',43),'UTF8'))
     and accepted_at is null) = 1,
  'rejected re-invitation remains unconsumed'
);
reset request.jwt.claim.sub;

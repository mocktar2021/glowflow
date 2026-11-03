-- GLOW-9 synthetic, local-only issuer policy checks. No mail is sent.
reset role;
reset request.jwt.claim.sub;

select public.test_assert(
  not has_function_privilege('anon', 'private.prepare_staff_invitation(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.prepare_staff_invitation(text)', 'execute')
  and not has_function_privilege('service_role', 'private.prepare_staff_invitation(text)', 'execute'),
  'issuer is inactive for all application roles'
);

set role authenticated;
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
select public.test_denied(
  'select * from private.prepare_staff_invitation(''issuer@example.invalid'')'
);
reset role;
reset request.jwt.claim.sub;

-- The trusted local harness supplies a synthetic Auth claim while calling as
-- the database owner. The function itself still checks the current owner.
select public.test_rejected(
  'select * from private.prepare_staff_invitation(''issuer@example.invalid'')',
  '22023'
);
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000002';
select public.test_rejected(
  'select * from private.prepare_staff_invitation(''issuer@example.invalid'')',
  '22023'
);
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000099';
select public.test_rejected(
  'select * from private.prepare_staff_invitation(''issuer@example.invalid'')',
  '22023'
);

set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
select public.test_rejected(
  'select * from private.prepare_staff_invitation(''invalid email'')',
  '22023'
);

create temporary table first_issuer_token as
  select * from private.prepare_staff_invitation('  Issuer@Example.Invalid  ');
select public.test_assert(
  (select count(*) from first_issuer_token
   where raw_token ~ '^[A-Za-z0-9_-]{43}$') = 1,
  'issuer returns one 43-character unpadded base64url token'
);
select public.test_assert(
  (select count(*) from private.staff_invitations as invitation
   join first_issuer_token as prepared
     on invitation.token_hash = sha256(convert_to(prepared.raw_token, 'UTF8'))
   where invitation.tenant_id = '10000000-0000-0000-0000-000000000001'
     and invitation.inviter_id = '20000000-0000-0000-0000-000000000001'
     and invitation.email_normalized = 'issuer@example.invalid'
     and invitation.expires_at = invitation.created_at + interval '48 hours'
     and invitation.expires_at = prepared.expires_at
     and invitation.revoked_at is null) = 1,
  'only a token digest is stored for the owner salon with exactly 48-hour expiry'
);

create temporary table second_issuer_token as
  select * from private.prepare_staff_invitation('issuer@example.invalid');
select public.test_assert(
  (select first.raw_token <> second.raw_token
   from first_issuer_token as first cross join second_issuer_token as second),
  'resend rotates to an independent random token'
);
select public.test_assert(
  (select count(*) from private.staff_invitations as invitation
   join first_issuer_token as first
     on invitation.token_hash = sha256(convert_to(first.raw_token, 'UTF8'))
   where invitation.revoked_at is not null and invitation.accepted_at is null) = 1,
  'resend revokes the preceding unaccepted token'
);
select public.test_assert(
  (select count(*) from private.staff_invitations
   where tenant_id = '10000000-0000-0000-0000-000000000001'
     and email_normalized = 'issuer@example.invalid'
     and accepted_at is null and revoked_at is null) = 1,
  'resend leaves exactly one active token for that salon and email'
);

-- Another owner may prepare the same email only for their own salon, without
-- changing the first salon's token state.
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000003';
create temporary table other_issuer_token as
  select * from private.prepare_staff_invitation('issuer@example.invalid');
select public.test_assert(
  (select count(*) from private.staff_invitations as invitation
   join other_issuer_token as prepared
     on invitation.token_hash = sha256(convert_to(prepared.raw_token, 'UTF8'))
   where invitation.tenant_id = '10000000-0000-0000-0000-000000000002'
     and invitation.inviter_id = '20000000-0000-0000-0000-000000000003') = 1,
  'foreign owner cannot issue into the first salon'
);
select public.test_assert(
  (select count(*) from private.staff_invitations
   where tenant_id = '10000000-0000-0000-0000-000000000001'
     and email_normalized = 'issuer@example.invalid'
     and accepted_at is null and revoked_at is null) = 1,
  'other salon issuance does not revoke this salon token'
);

insert into auth.users(id, email, email_confirmed_at) values
  ('20000000-0000-0000-0000-000000000096', 'issuer@example.invalid', now());
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000096';
select public.test_rejected(
  'select public.accept_staff_invitation((select raw_token from first_issuer_token),''Revoked Staff'',''fr'')',
  '22023'
);
select public.test_assert(
  (select public.accept_staff_invitation(prepared.raw_token, 'Issuer Staff', 'en')
   from second_issuer_token as prepared)
    = '10000000-0000-0000-0000-000000000001'::uuid,
  'only the latest token can be accepted by the verified recipient'
);
select public.test_assert(
  (select count(*) from public.users
   where id = '20000000-0000-0000-0000-000000000096'
     and tenant_id = '10000000-0000-0000-0000-000000000001'
     and role = 'staff' and locale = 'en') = 1,
  'prepared token connects to the existing verified acceptance contract'
);
reset request.jwt.claim.sub;

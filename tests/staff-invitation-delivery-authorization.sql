-- GLOW-9 disposable-local PostgreSQL checks. No email is sent.
reset role;
reset request.jwt.claim.sub;

update auth.users set email_confirmed_at = now()
where id in (
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003'
);

select public.test_assert(
  (select relrowsecurity from pg_class
   where oid = 'private.staff_invitation_delivery_outbox'::regclass)
  and not has_table_privilege('anon', 'private.staff_invitation_delivery_outbox', 'select')
  and not has_table_privilege('authenticated', 'private.staff_invitation_delivery_outbox', 'select')
  and not has_table_privilege('service_role', 'private.staff_invitation_delivery_outbox', 'select'),
  'encrypted outbox has RLS and no direct application-role reads'
);
select public.test_assert(
  has_function_privilege('service_role', 'public.enqueue_staff_invitation_delivery(uuid,text,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.claim_staff_invitation_delivery(text)', 'execute')
  and has_function_privilege('service_role', 'public.settle_staff_invitation_delivery(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.enqueue_staff_invitation_delivery(uuid,text,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.enqueue_staff_invitation_delivery(uuid,text,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_staff_invitation_delivery(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.settle_staff_invitation_delivery(uuid,text,text)', 'execute'),
  'only service_role can invoke delivery RPCs'
);

set role authenticated;
select public.test_denied(
  'select public.enqueue_staff_invitation_delivery(''20000000-0000-0000-0000-000000000001'',
   ''staff@example.invalid'', gen_random_uuid(), ''local-test-passphrase-at-least-32-bytes'')'
);
select public.test_denied(
  'select * from public.claim_staff_invitation_delivery(''local-test-passphrase-at-least-32-bytes'')'
);
reset role;

select public.test_rejected(
  'select public.enqueue_staff_invitation_delivery(''20000000-0000-0000-0000-000000000002'',
   ''staff@example.invalid'', gen_random_uuid(), ''local-test-passphrase-at-least-32-bytes'')',
  '22023'
);
select public.test_rejected(
  'select public.enqueue_staff_invitation_delivery(''20000000-0000-0000-0000-000000000001'',
   ''bad email'', gen_random_uuid(), ''local-test-passphrase-at-least-32-bytes'')',
  '22023'
);

-- The old delivered link remains usable until a new delivery is acknowledged.
set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
create temporary table prior_link as
  select * from private.prepare_staff_invitation('handoff@example.invalid');
reset request.jwt.claim.sub;

create temporary table first_delivery as
  select public.enqueue_staff_invitation_delivery(
    '20000000-0000-0000-0000-000000000001', '  Handoff@Example.Invalid  ',
    '71000000-0000-4000-8000-000000000001',
    'local-test-passphrase-at-least-32-bytes') as id;
select public.test_assert(
  (select id from first_delivery) = public.enqueue_staff_invitation_delivery(
    '20000000-0000-0000-0000-000000000001', 'handoff@example.invalid',
    '71000000-0000-4000-8000-000000000001',
    'local-test-passphrase-at-least-32-bytes'),
  'same business request returns its durable delivery ID'
);
select public.test_assert(
  (select id from first_delivery) = public.enqueue_staff_invitation_delivery(
    '20000000-0000-0000-0000-000000000001', 'handoff@example.invalid',
    '71000000-0000-4000-8000-000000000002',
    'local-test-passphrase-at-least-32-bytes'),
  'a still-pending recipient has only one outbox payload'
);
select public.test_assert(
  (select count(*) from private.staff_invitation_delivery_outbox
   where email_normalized = 'handoff@example.invalid') = 1
  and (select count(*) from private.staff_invitations as invitation
       join prior_link as prior
         on invitation.token_hash = sha256(convert_to(prior.raw_token, 'UTF8'))
       where invitation.revoked_at is null) = 1,
  'queueing never revokes a previous usable link'
);

create temporary table first_claim as
  select * from public.claim_staff_invitation_delivery('local-test-passphrase-at-least-32-bytes');
select public.test_assert(
  (select count(*) from first_claim
   where delivery_id = (select id from first_delivery)
     and raw_token ~ '^[A-Za-z0-9_-]{43}$'
     and recipient_email = 'handoff@example.invalid'
     and idempotency_key = 'glowflow-staff-invite-' || delivery_id::text
     and attempt_number = 1) = 1,
  'leased handoff returns one recipient and a stable provider idempotency key'
);
select public.test_assert(
  (select count(*) from private.staff_invitation_delivery_outbox as delivery
   join first_claim as claim on claim.delivery_id = delivery.id
   join private.staff_invitations as invitation on invitation.id = delivery.invitation_id
   where invitation.token_hash = sha256(convert_to(claim.raw_token, 'UTF8'))
     and delivery.token_ciphertext <> convert_to(claim.raw_token, 'UTF8')
     and delivery.status = 'leased') = 1,
  'the outbox stores ciphertext and the invitation stores only a token digest'
);
select public.test_assert(
  public.settle_staff_invitation_delivery((select id from first_delivery), 'failed'),
  'provider failure can settle an active lease'
);
select public.test_assert(
  (select count(*) from private.staff_invitations as invitation
       join prior_link as prior
         on invitation.token_hash = sha256(convert_to(prior.raw_token, 'UTF8'))
       where invitation.revoked_at is null) = 1
  and (select count(*) from private.staff_invitation_delivery_outbox
       where id = (select id from first_delivery)
         and status = 'failed' and token_ciphertext is null) = 1,
  'definite non-delivery clears the new token but preserves the old link'
);

create temporary table second_delivery as
  select public.enqueue_staff_invitation_delivery(
    '20000000-0000-0000-0000-000000000001', 'handoff@example.invalid',
    '71000000-0000-4000-8000-000000000003',
    'local-test-passphrase-at-least-32-bytes') as id;
create temporary table second_claim as
  select * from public.claim_staff_invitation_delivery('local-test-passphrase-at-least-32-bytes');
select public.test_assert(
  (select delivery_id from second_claim) = (select id from second_delivery),
  'retry after a definite failure prepares a fresh encrypted token'
);
select public.test_assert(
  public.settle_staff_invitation_delivery((select id from second_delivery), 'sent', 'provider-fixture-1')
  and public.settle_staff_invitation_delivery((select id from second_delivery), 'sent', 'provider-fixture-1'),
  'provider acknowledgement is idempotent'
);
select public.test_assert(
  (select count(*) from private.staff_invitations as invitation
       join prior_link as prior
         on invitation.token_hash = sha256(convert_to(prior.raw_token, 'UTF8'))
       where invitation.revoked_at is not null) = 1
  and (select count(*) from private.staff_invitation_delivery_outbox
       where id = (select id from second_delivery)
         and status = 'sent' and token_ciphertext is null
         and provider_message_id = 'provider-fixture-1') = 1,
  'only a successful provider acknowledgement rotates the usable link'
);

-- Limits count all attempts, including definite provider failures. The
-- delivery actor cannot clear the limit by failing or retrying a request.
do $$
declare
  prepared_id uuid;
  claimed_id uuid;
  attempt integer;
begin
  for attempt in 1..3 loop
    prepared_id := public.enqueue_staff_invitation_delivery(
      '20000000-0000-0000-0000-000000000001', 'recipient-limit@example.invalid',
      gen_random_uuid(), 'local-test-passphrase-at-least-32-bytes');
    select delivery_id into claimed_id
      from public.claim_staff_invitation_delivery('local-test-passphrase-at-least-32-bytes');
    if claimed_id is distinct from prepared_id
       or not public.settle_staff_invitation_delivery(prepared_id, 'failed') then
      raise exception 'delivery_limit_fixture_failed';
    end if;
  end loop;
end;
$$;
select public.test_rejected(
  'select public.enqueue_staff_invitation_delivery(''20000000-0000-0000-0000-000000000001'',
   ''recipient-limit@example.invalid'', gen_random_uuid(),
   ''local-test-passphrase-at-least-32-bytes'')',
  '22023'
);

-- The same owner cannot bypass the daily cap by rotating recipients.
do $$
declare
  prepared_id uuid;
  claimed_id uuid;
  attempt integer;
begin
  for attempt in 1..15 loop
    prepared_id := public.enqueue_staff_invitation_delivery(
      '20000000-0000-0000-0000-000000000001',
      'owner-limit-' || attempt || '@example.invalid',
      gen_random_uuid(), 'local-test-passphrase-at-least-32-bytes');
    select delivery_id into claimed_id
      from public.claim_staff_invitation_delivery('local-test-passphrase-at-least-32-bytes');
    if claimed_id is distinct from prepared_id
       or not public.settle_staff_invitation_delivery(prepared_id, 'failed') then
      raise exception 'owner_limit_fixture_failed';
    end if;
  end loop;
end;
$$;
select public.test_rejected(
  'select public.enqueue_staff_invitation_delivery(''20000000-0000-0000-0000-000000000001'',
   ''owner-limit-final@example.invalid'', gen_random_uuid(),
   ''local-test-passphrase-at-least-32-bytes'')',
  '22023'
);

-- A second salon has an independent per-owner and per-recipient scope.
create temporary table other_salon_delivery as
  select public.enqueue_staff_invitation_delivery(
    '20000000-0000-0000-0000-000000000003', 'handoff@example.invalid',
    '71000000-0000-4000-8000-000000000004',
    'local-test-passphrase-at-least-32-bytes') as id;
select public.test_assert(
  (select count(*) from private.staff_invitation_delivery_outbox
   where id = (select id from other_salon_delivery)
     and tenant_id = '10000000-0000-0000-0000-000000000002') = 1,
  'one salon cannot issue into another salon'
);

-- A lost provider acknowledgement is not a known non-send. The same
-- recipient must remain blocked from a new token until an operator reconciles
-- the possibly delivered invitation. This uses only disposable local data.
create temporary table uncertain_claim as
  select * from public.claim_staff_invitation_delivery(
    'local-test-passphrase-at-least-32-bytes');
select public.test_assert(
  (select count(*) from uncertain_claim
   where delivery_id = (select id from other_salon_delivery)
     and attempt_number = 1) = 1,
  'second-salon handoff obtains exactly one provider claim'
);
select public.test_assert(
  public.settle_staff_invitation_delivery(
    (select id from other_salon_delivery), 'uncertain'),
  'ambiguous provider outcome settles as uncertain'
);
select public.test_assert(
  (select count(*) from private.staff_invitation_delivery_outbox as delivery
   join private.staff_invitations as invitation
     on invitation.id = delivery.invitation_id
   where delivery.id = (select id from other_salon_delivery)
     and delivery.status = 'uncertain'
     and delivery.token_ciphertext is not null
     and delivery.lease_until is null
     and delivery.provider_message_id is null
     and invitation.revoked_at is null) = 1,
  'uncertain delivery preserves its token and awaits reconciliation'
);
select public.test_assert(
  (select id from other_salon_delivery) = public.enqueue_staff_invitation_delivery(
    '20000000-0000-0000-0000-000000000003', 'handoff@example.invalid',
    '71000000-0000-4000-8000-000000000005',
    'local-test-passphrase-at-least-32-bytes')
  and (select count(*) from private.staff_invitation_delivery_outbox
       where tenant_id = '10000000-0000-0000-0000-000000000002'
         and email_normalized = 'handoff@example.invalid') = 1,
  'a fresh request key cannot create a second token after an uncertain send'
);
select public.test_assert(
  (select count(*) from public.claim_staff_invitation_delivery(
    'local-test-passphrase-at-least-32-bytes')) = 0,
  'an uncertain delivery cannot be blindly reclaimed for another send'
);
reset request.jwt.claim.sub;

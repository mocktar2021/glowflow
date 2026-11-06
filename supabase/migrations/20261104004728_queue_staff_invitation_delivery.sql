-- GLOW-9: inactive, service-only invitation delivery contract.
-- No application route, mail provider, scheduler, or feature flag is enabled.
begin;

do $$
begin
  if to_regclass('private.staff_invitations') is null
     or to_regprocedure('public.accept_staff_invitation(text,text,text)') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null
     or to_regprocedure('extensions.pgp_sym_encrypt(text,text,text)') is null
     or to_regprocedure('extensions.pgp_sym_decrypt(bytea,text)') is null then
    raise exception using errcode = '55000',
      message = 'staff_invitation_delivery_predecessor_missing';
  end if;
end;
$$;

create table private.staff_invitation_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  inviter_id uuid not null,
  invitation_id uuid not null unique references private.staff_invitations(id) on delete cascade,
  email_normalized text not null check (
    char_length(email_normalized) between 3 and 320
    and email_normalized = lower(btrim(email_normalized))
    and email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  request_key uuid not null unique,
  token_ciphertext bytea,
  status text not null default 'queued' check (
    status in ('queued', 'leased', 'retry', 'sent', 'failed', 'uncertain')
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  check ((status = 'leased') = (lease_until is not null)),
  check ((status in ('sent', 'failed')) = (token_ciphertext is null)),
  check (status <> 'sent' or (sent_at is not null and provider_message_id is not null)),
  check (provider_message_id is null or char_length(provider_message_id) between 1 and 200)
);

create unique index staff_invitation_delivery_one_open
  on private.staff_invitation_delivery_outbox (tenant_id, email_normalized)
  where status in ('queued', 'leased', 'retry', 'uncertain');
create index staff_invitation_delivery_recipient_limit
  on private.staff_invitation_delivery_outbox (tenant_id, email_normalized, created_at desc);
create index staff_invitation_delivery_owner_limit
  on private.staff_invitation_delivery_outbox (inviter_id, created_at desc);
create index staff_invitation_delivery_claim
  on private.staff_invitation_delivery_outbox (next_attempt_at, created_at)
  where status in ('queued', 'leased', 'retry');

alter table private.staff_invitation_delivery_outbox enable row level security;
-- Neither browsers nor the service-role Data API may read this private table.
revoke all on table private.staff_invitation_delivery_outbox
  from public, anon, authenticated, service_role;

create function public.enqueue_staff_invitation_delivery(
  requesting_owner_id uuid,
  target_email text,
  delivery_request_key uuid,
  encryption_passphrase text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(target_email));
  owner_tenant_id uuid;
  existing_delivery private.staff_invitation_delivery_outbox%rowtype;
  new_invitation_id uuid;
  new_delivery_id uuid;
  issued_at timestamptz;
  raw_token text;
begin
  if requesting_owner_id is null or delivery_request_key is null
     or normalized_email is null
     or pg_catalog.char_length(normalized_email) not between 3 and 320
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
     or encryption_passphrase is null
     or pg_catalog.octet_length(encryption_passphrase) not between 32 and 256 then
    raise exception using errcode = '22023', message = 'staff_invitation_delivery_unavailable';
  end if;

  -- Serialize requests for a salon before checking the persistent limits.
  -- Only a verified Auth identity that currently owns this tenant qualifies.
  select tenant.id into owner_tenant_id
  from public.tenants as tenant
  join public.users as owner_membership
    on owner_membership.id = tenant.owner_id
   and owner_membership.tenant_id = tenant.id
   and owner_membership.role = 'owner'
  join auth.users as identity
    on identity.id = owner_membership.id
   and identity.email_confirmed_at is not null
  where tenant.owner_id = requesting_owner_id
  for update of tenant, owner_membership;

  if not found then
    raise exception using errcode = '22023', message = 'staff_invitation_delivery_unavailable';
  end if;

  -- A retry of the same business request never creates another token.
  select * into existing_delivery
  from private.staff_invitation_delivery_outbox as delivery
  where delivery.request_key = delivery_request_key;
  if found then
    if existing_delivery.tenant_id = owner_tenant_id
       and existing_delivery.inviter_id = requesting_owner_id
       and existing_delivery.email_normalized = normalized_email then
      return existing_delivery.id;
    end if;
    raise exception using errcode = '22023', message = 'staff_invitation_delivery_unavailable';
  end if;

  issued_at := pg_catalog.clock_timestamp();
  -- Release a stale pending slot only after its invitation can no longer be
  -- redeemed. The prior delivered link is untouched.
  update private.staff_invitation_delivery_outbox as delivery
  set status = 'failed', token_ciphertext = null, lease_until = null
  from private.staff_invitations as invitation
  where delivery.invitation_id = invitation.id
    and delivery.tenant_id = owner_tenant_id
    and delivery.email_normalized = normalized_email
    and delivery.status in ('queued', 'leased', 'retry', 'uncertain')
    and invitation.expires_at <= issued_at;

  select * into existing_delivery
  from private.staff_invitation_delivery_outbox as delivery
  where delivery.tenant_id = owner_tenant_id
    and delivery.email_normalized = normalized_email
    and delivery.status in ('queued', 'leased', 'retry', 'uncertain');
  if found then return existing_delivery.id; end if;

  if (select pg_catalog.count(*) from private.staff_invitation_delivery_outbox as delivery
      where delivery.tenant_id = owner_tenant_id
        and delivery.email_normalized = normalized_email
        and delivery.created_at >= issued_at - interval '1 hour') >= 3
     or (select pg_catalog.count(*) from private.staff_invitation_delivery_outbox as delivery
      where delivery.inviter_id = requesting_owner_id
        and delivery.created_at >= issued_at - interval '1 day') >= 20 then
    raise exception using errcode = '22023', message = 'staff_invitation_delivery_unavailable';
  end if;

  raw_token := pg_catalog.rtrim(
    pg_catalog.translate(
      pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'
    ), '='
  );
  insert into private.staff_invitations
    (tenant_id, inviter_id, email_normalized, token_hash, created_at, expires_at)
  values
    (owner_tenant_id, requesting_owner_id, normalized_email,
     pg_catalog.sha256(pg_catalog.convert_to(raw_token, 'UTF8')),
     issued_at, issued_at + interval '48 hours')
  returning id into new_invitation_id;

  insert into private.staff_invitation_delivery_outbox
    (tenant_id, inviter_id, invitation_id, email_normalized, request_key,
     token_ciphertext, created_at, next_attempt_at)
  values
    (owner_tenant_id, requesting_owner_id, new_invitation_id, normalized_email,
     delivery_request_key,
     extensions.pgp_sym_encrypt(raw_token, encryption_passphrase, 'cipher-algo=aes256'),
     issued_at, issued_at)
  returning id into new_delivery_id;
  return new_delivery_id;
end;
$$;

revoke all on function public.enqueue_staff_invitation_delivery(uuid,text,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_staff_invitation_delivery(uuid,text,uuid,text)
  to service_role;

create function public.claim_staff_invitation_delivery(encryption_passphrase text)
returns table (
  delivery_id uuid,
  recipient_email text,
  raw_token text,
  expires_at timestamptz,
  idempotency_key text,
  attempt_number integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_delivery private.staff_invitation_delivery_outbox%rowtype;
  selected_expiry timestamptz;
  claim_time timestamptz := pg_catalog.clock_timestamp();
begin
  if encryption_passphrase is null
     or pg_catalog.octet_length(encryption_passphrase) not between 32 and 256 then
    raise exception using errcode = '22023', message = 'staff_invitation_delivery_unavailable';
  end if;

  -- Expired links cannot be sent. This also clears encrypted payloads and
  -- opens a recipient slot for a later, separately throttled request.
  update private.staff_invitation_delivery_outbox as delivery
  set status = 'failed', token_ciphertext = null, lease_until = null
  from private.staff_invitations as invitation
  where delivery.invitation_id = invitation.id
    and delivery.status in ('queued', 'leased', 'retry', 'uncertain')
    and invitation.expires_at <= claim_time;
  update private.staff_invitation_delivery_outbox as delivery
  set status = 'uncertain', lease_until = null
  where delivery.status = 'leased'
    and delivery.lease_until <= claim_time
    and delivery.attempt_count >= 3;

  select delivery.* into selected_delivery
  from private.staff_invitation_delivery_outbox as delivery
  join private.staff_invitations as invitation
    on invitation.id = delivery.invitation_id
   and invitation.accepted_at is null and invitation.revoked_at is null
   and invitation.expires_at > claim_time
  join public.tenants as tenant
    on tenant.id = delivery.tenant_id and tenant.owner_id = delivery.inviter_id
  join public.users as owner_membership
    on owner_membership.id = tenant.owner_id
   and owner_membership.tenant_id = tenant.id
   and owner_membership.role = 'owner'
  where (delivery.status in ('queued', 'retry')
         or (delivery.status = 'leased' and delivery.lease_until <= claim_time))
    and delivery.next_attempt_at <= claim_time
    and delivery.attempt_count < 3
  order by delivery.next_attempt_at, delivery.created_at
  for update of delivery skip locked
  limit 1;

  if not found then return; end if;

  update private.staff_invitation_delivery_outbox as delivery
  set status = 'leased', attempt_count = delivery.attempt_count + 1,
      lease_until = claim_time + interval '2 minutes'
  where delivery.id = selected_delivery.id;

  select invitation.expires_at into selected_expiry
  from private.staff_invitations as invitation
  where invitation.id = selected_delivery.invitation_id;
  return query select selected_delivery.id, selected_delivery.email_normalized,
    extensions.pgp_sym_decrypt(selected_delivery.token_ciphertext, encryption_passphrase),
    selected_expiry, 'glowflow-staff-invite-' || selected_delivery.id::text,
    selected_delivery.attempt_count + 1;
end;
$$;

revoke all on function public.claim_staff_invitation_delivery(text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_staff_invitation_delivery(text) to service_role;

create function public.settle_staff_invitation_delivery(
  target_delivery_id uuid,
  delivery_outcome text,
  provider_reference text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  delivery private.staff_invitation_delivery_outbox%rowtype;
  delivery_time timestamptz := pg_catalog.clock_timestamp();
  invitation_expiry timestamptz;
begin
  if target_delivery_id is null
     or delivery_outcome is null
     or delivery_outcome not in ('sent', 'retry', 'failed', 'uncertain')
     or (delivery_outcome = 'sent' and
         (provider_reference is null or pg_catalog.char_length(provider_reference) not between 1 and 200)) then
    raise exception using errcode = '22023', message = 'staff_invitation_delivery_unavailable';
  end if;

  -- Acceptance locks invitation rows before the tenant. Lock invitations
  -- before this outbox row to avoid a resend/acceptance/settlement cycle.
  perform 1
  from private.staff_invitations as invitation
  join private.staff_invitation_delivery_outbox as candidate
    on candidate.tenant_id = invitation.tenant_id
   and candidate.email_normalized = invitation.email_normalized
  where candidate.id = target_delivery_id
    and invitation.accepted_at is null and invitation.revoked_at is null
  order by invitation.id
  for update of invitation;

  select * into delivery
  from private.staff_invitation_delivery_outbox as candidate
  where candidate.id = target_delivery_id
  for update;
  if not found then return false; end if;
  if delivery.status = 'sent' and delivery_outcome = 'sent'
     and delivery.provider_message_id = provider_reference then return true; end if;
  if delivery.status <> 'leased' or delivery.lease_until <= delivery_time then
    return false;
  end if;

  select invitation.expires_at into invitation_expiry
  from private.staff_invitations as invitation
  where invitation.id = delivery.invitation_id;
  if invitation_expiry <= delivery_time then return false; end if;

  if delivery_outcome = 'sent' then
    -- A known successful provider acknowledgement is the only event that
    -- revokes the previous usable link.
    update private.staff_invitations as invitation
    set revoked_at = delivery_time
    where invitation.tenant_id = delivery.tenant_id
      and invitation.email_normalized = delivery.email_normalized
      and invitation.id <> delivery.invitation_id
      and invitation.accepted_at is null and invitation.revoked_at is null;
    update private.staff_invitation_delivery_outbox as candidate
    set status = 'sent', sent_at = delivery_time,
        provider_message_id = provider_reference, token_ciphertext = null,
        lease_until = null
    where candidate.id = delivery.id;
  elsif delivery_outcome = 'failed' then
    -- Definite non-delivery invalidates only the unsent new link.
    update private.staff_invitations as invitation
    set revoked_at = delivery_time
    where invitation.id = delivery.invitation_id
      and invitation.accepted_at is null and invitation.revoked_at is null;
    update private.staff_invitation_delivery_outbox as candidate
    set status = 'failed', token_ciphertext = null, lease_until = null
    where candidate.id = delivery.id;
  elsif delivery_outcome = 'retry' and delivery.attempt_count < 3 then
    update private.staff_invitation_delivery_outbox as candidate
    set status = 'retry', lease_until = null,
        next_attempt_at = delivery_time +
          case delivery.attempt_count
            when 1 then interval '1 minute'
            else interval '5 minutes'
          end
    where candidate.id = delivery.id;
  else
    -- Unknown send outcome or exhausted retries require reconciliation;
    -- neither the old nor the possibly delivered new link is revoked.
    update private.staff_invitation_delivery_outbox as candidate
    set status = 'uncertain', lease_until = null
    where candidate.id = delivery.id;
  end if;
  return true;
end;
$$;

revoke all on function public.settle_staff_invitation_delivery(uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_staff_invitation_delivery(uuid,text,text)
  to service_role;

comment on table private.staff_invitation_delivery_outbox is
  'Inactive encrypted invitation delivery queue; only a separately reviewed server sender may claim it.';
comment on function public.enqueue_staff_invitation_delivery(uuid,text,uuid,text) is
  'Service-only owner-checked enqueue with durable limits; does not send email or revoke an older invitation.';
comment on function public.claim_staff_invitation_delivery(text) is
  'Service-only lease; returns a decrypted token only to a future trusted sender.';
comment on function public.settle_staff_invitation_delivery(uuid,text,text) is
  'Service-only acknowledgement, retry, failure, and uncertain-outcome transition.';

commit;

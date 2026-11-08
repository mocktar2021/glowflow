-- GLOW-27: a claim must still describe the current appointment at claim time.
-- This changes only the dormant, provider-neutral notification claim contract.
-- No worker or external sender is enabled by this migration.
-- If a hosted rollout must be stopped, first review the live fingerprints,
-- then use supabase/rollbacks/20261101172437_disable_notification_claims_and_scheduling.sql
-- to fail closed without restoring the earlier permissive claim functions.

begin;

do $$
begin
  if to_regprocedure('private.notification_delivery_eligible(uuid, timestamptz)') is null
     or to_regprocedure('public.claim_notification_delivery(uuid, uuid, timestamptz)') is null
     or not exists (
       -- An inherited PUBLIC grant is not sufficient: it is revoked below.
       select 1
       from pg_catalog.pg_proc as function_row
       cross join lateral pg_catalog.aclexplode(function_row.proacl) as grant_row
       where function_row.oid = to_regprocedure(
         'public.claim_notification_delivery(uuid, uuid, timestamptz)'
       )
         and grant_row.grantee = to_regrole('service_role')
         and grant_row.privilege_type = 'EXECUTE'
     ) then
    raise exception using errcode = '55000',
      message = 'notification_claim_predecessor_missing';
  end if;
end;
$$;

create function private.notification_delivery_current_context(
  target_outbox_id uuid,
  evaluated_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with selected as (
    select outbox.tenant_id, outbox.client_id, outbox.channel
    from public.notification_outbox as outbox
    join public.appointments as appointment
      on appointment.id = outbox.appointment_id
     and appointment.tenant_id = outbox.tenant_id
     and appointment.client_id = outbox.client_id
    where outbox.id = target_outbox_id
      and appointment.status = 'confirmed'
      and appointment.notification_schedule_generation = outbox.schedule_generation
      and appointment.start_time = outbox.appointment_start_time
      and outbox.scheduled_for <= evaluated_at
  ), consent as (
    select event.consent_status
    from public.client_notification_consent_events as event
    join selected
      on selected.tenant_id = event.tenant_id
     and selected.client_id = event.client_id
     and selected.channel = event.channel
    where event.consent_status = 'opted_out' or event.occurred_at <= now()
    order by event.occurred_at desc, event.created_at desc, event.id desc
    limit 1
  )
  select coalesce(
    exists (select 1 from selected)
    and coalesce((select consent_status from consent) = 'consented', false),
    false
  );
$$;

create or replace function private.notification_delivery_eligible(
  target_outbox_id uuid,
  evaluated_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select attempt.event_type, attempt.retry_after, attempt.lease_expires_at
    from public.notification_delivery_attempts as attempt
    where attempt.outbox_id = target_outbox_id
    order by attempt.occurred_at desc, attempt.created_at desc, attempt.id desc
    limit 1
  )
  select coalesce(
    private.notification_delivery_current_context(target_outbox_id, evaluated_at)
    and case
      when not exists (select 1 from latest) then true
      when (select event_type from latest) = 'retryable'
        then (select retry_after from latest) <= evaluated_at
      when (select event_type from latest) = 'claimed'
        then (select lease_expires_at from latest) <= evaluated_at
      else false
    end,
    false
  );
$$;

create or replace function public.claim_notification_delivery(
  target_outbox_id uuid,
  target_event_key uuid,
  target_claimed_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_outbox public.notification_outbox%rowtype;
  existing_event public.notification_delivery_attempts%rowtype;
  latest_event public.notification_delivery_attempts%rowtype;
  next_attempt integer;
  new_event_id uuid;
begin
  if target_event_key is null
     or target_claimed_at is null
     or target_claimed_at < now() - interval '5 minutes'
     or target_claimed_at > now() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'invalid_notification_claim_time';
  end if;

  select * into selected_outbox
  from public.notification_outbox
  where id = target_outbox_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'notification_outbox_not_found';
  end if;

  select * into existing_event
  from public.notification_delivery_attempts
  where tenant_id = selected_outbox.tenant_id and event_key = target_event_key;

  if found then
    if existing_event.outbox_id is distinct from target_outbox_id
       or existing_event.event_type <> 'claimed'
       or existing_event.occurred_at is distinct from target_claimed_at then
      raise exception using errcode = '22023', message = 'notification_claim_request_mismatch';
    end if;

    -- A matching key is idempotent only while its original claim remains
    -- the active lease and the appointment/consent context is still current.
    -- Do not call notification_delivery_eligible here: an active lease makes
    -- that full predicate false, even for a valid same-key replay.
    select * into latest_event
    from public.notification_delivery_attempts
    where outbox_id = target_outbox_id
    order by occurred_at desc, created_at desc, id desc
    limit 1;

    if not private.notification_delivery_current_context(target_outbox_id, now())
       or latest_event.id is distinct from existing_event.id
       or not coalesce(existing_event.lease_expires_at > now(), false)
       or exists (
         select 1 from public.notification_delivery_attempts as result
         where result.claim_event_id = existing_event.id
       ) then
      raise exception using errcode = '55000', message = 'notification_not_eligible';
    end if;
    return existing_event.id;
  end if;

  -- The caller's bounded event timestamp is not authority to claim a reminder
  -- before its due time or to advance an existing retry/lease eligibility clock.
  if not private.notification_delivery_eligible(target_outbox_id, now()) then
    raise exception using errcode = '55000', message = 'notification_not_eligible';
  end if;

  select coalesce(max(attempt_number), 0) + 1 into next_attempt
  from public.notification_delivery_attempts
  where outbox_id = target_outbox_id and event_type = 'claimed';

  insert into public.notification_delivery_attempts (
    tenant_id, outbox_id, event_type, attempt_number, event_key,
    lease_expires_at, occurred_at
  ) values (
    selected_outbox.tenant_id, target_outbox_id, 'claimed', next_attempt,
    target_event_key, target_claimed_at + interval '5 minutes', target_claimed_at
  ) returning id into new_event_id;

  return new_event_id;
end;
$$;

-- CREATE OR REPLACE retains the original service-role claim grant. New
-- helper functions must not be callable directly by application roles.
revoke all on function private.notification_delivery_current_context(uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.notification_delivery_eligible(uuid, timestamptz)
from public, anon, authenticated;
revoke all on function public.claim_notification_delivery(uuid, uuid, timestamptz)
from public, anon, authenticated;

commit;

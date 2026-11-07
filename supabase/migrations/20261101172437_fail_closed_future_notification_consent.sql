-- GLOW-29: fail closed when consent timestamps are slightly ahead of DB time.
-- A future opt-in cannot authorize a claim; a future opt-out blocks immediately.
-- This only changes persisted eligibility and read status. No worker or send is enabled.
-- Requires 20261018000135_schedule_confirmed_appointment_notifications first.

begin;

do $$
begin
  if to_regprocedure('private.enqueue_confirmed_appointment_email()') is null
     or not exists (
       select 1 from pg_catalog.pg_trigger
       where tgrelid = to_regclass('public.appointments')
         and tgname = 'appointments_enqueue_confirmed_email'
         and tgfoid = to_regprocedure('private.enqueue_confirmed_appointment_email()')
         and not tgisinternal
     ) then
    raise exception using errcode = '55000',
      message = 'notification_scheduler_predecessor_missing';
  end if;
end;
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
  with selected as (
    select outbox.*
    from public.notification_outbox as outbox
    join public.appointments as appointment
      on appointment.id = outbox.appointment_id
     and appointment.tenant_id = outbox.tenant_id
    where outbox.id = target_outbox_id
      and appointment.status = 'confirmed'
      and appointment.notification_schedule_generation = outbox.schedule_generation
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
  ), latest as (
    select attempt.event_type, attempt.retry_after, attempt.lease_expires_at
    from public.notification_delivery_attempts as attempt
    where attempt.outbox_id = target_outbox_id
    order by attempt.occurred_at desc, attempt.created_at desc, attempt.id desc
    limit 1
  )
  select coalesce(exists (select 1 from selected)
    -- PL/pgSQL's `if not eligible then` does not reject NULL. Return FALSE
    -- for unknown consent so a trusted outbox row cannot be claimed without it.
    and coalesce((select consent_status from consent) = 'consented', false)
    and case
      when not exists (select 1 from latest) then true
      when (select event_type from latest) = 'retryable'
        then (select retry_after from latest) <= evaluated_at
      when (select event_type from latest) = 'claimed'
        then (select lease_expires_at from latest) <= evaluated_at
      else false
    end, false);
$$;

create or replace function public.get_notification_status_rows(
  target_tenant_id uuid,
  row_limit integer default 100
)
returns table (
  id uuid,
  appointment_id uuid,
  client_id uuid,
  appointment_start_time timestamptz,
  schedule_generation bigint,
  notification_kind text,
  channel text,
  scheduled_for timestamptz,
  appointment_status text,
  current_appointment_start_time timestamptz,
  current_schedule_generation bigint,
  consent_status text,
  latest_event_type text,
  latest_retry_after timestamptz,
  latest_lease_expires_at timestamptz,
  latest_occurred_at timestamptz,
  attempt_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    outbox.id,
    outbox.appointment_id,
    outbox.client_id,
    outbox.appointment_start_time,
    outbox.schedule_generation,
    outbox.notification_kind,
    outbox.channel,
    outbox.scheduled_for,
    appointment.status,
    appointment.start_time,
    appointment.notification_schedule_generation,
    consent.consent_status,
    latest.event_type,
    latest.retry_after,
    latest.lease_expires_at,
    latest.occurred_at,
    coalesce(attempts.attempt_count, 0)
  from public.notification_outbox as outbox
  join public.appointments as appointment
    on appointment.id = outbox.appointment_id
   and appointment.tenant_id = outbox.tenant_id
  left join lateral (
    select event.consent_status
    from public.client_notification_consent_events as event
    where event.tenant_id = outbox.tenant_id
      and event.client_id = outbox.client_id
      and event.channel = outbox.channel
      and (event.consent_status = 'opted_out' or event.occurred_at <= now())
    order by event.occurred_at desc, event.created_at desc, event.id desc
    limit 1
  ) as consent on true
  left join lateral (
    select attempt.event_type, attempt.retry_after,
      attempt.lease_expires_at, attempt.occurred_at
    from public.notification_delivery_attempts as attempt
    where attempt.outbox_id = outbox.id
    order by attempt.occurred_at desc, attempt.created_at desc, attempt.id desc
    limit 1
  ) as latest on true
  left join lateral (
    select count(*)::bigint as attempt_count
    from public.notification_delivery_attempts as attempt
    where attempt.outbox_id = outbox.id and attempt.event_type = 'claimed'
  ) as attempts on true
  where outbox.tenant_id = target_tenant_id
    and (select private.is_tenant_member(target_tenant_id))
  order by outbox.scheduled_for desc, outbox.id desc
  limit least(greatest(coalesce(row_limit, 100), 1), 100);
$$;

create or replace function private.enqueue_confirmed_appointment_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  email_address text;
  latest_consent text;
  schedule_key uuid;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'appointments'
     or tg_op not in ('INSERT', 'UPDATE') then
    raise exception using errcode = '42501', message = 'invalid_notification_trigger_context';
  end if;

  if new.status <> 'confirmed' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.notification_schedule_generation = old.notification_schedule_generation then
      return new;
    end if;
  end if;

  select client.email into email_address
  from public.clients as client
  where client.id = new.client_id and client.tenant_id = new.tenant_id;

  if nullif(btrim(email_address), '') is null then return new; end if;

  select event.consent_status into latest_consent
  from public.client_notification_consent_events as event
  where event.tenant_id = new.tenant_id
    and event.client_id = new.client_id
    and event.channel = 'email'
    and (event.consent_status = 'opted_out' or event.occurred_at <= now())
  order by event.occurred_at desc, event.created_at desc, event.id desc
  limit 1;

  if latest_consent is distinct from 'consented' then return new; end if;

  schedule_key := md5(
    'glowflow:g27:email:' || new.id::text || ':' ||
    new.notification_schedule_generation::text
  )::uuid;

  perform public.schedule_appointment_notifications(new.id, 'email', schedule_key);
  return new;
end;
$$;

-- CREATE OR REPLACE keeps the existing grants. Restate the private boundaries.
revoke all on function private.notification_delivery_eligible(uuid, timestamptz)
from public, anon, authenticated;
revoke all on function private.enqueue_confirmed_appointment_email()
from public, anon, authenticated, service_role;

commit;

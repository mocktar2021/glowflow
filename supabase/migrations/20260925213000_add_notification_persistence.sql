-- GLOW-29: provider-neutral notification consent, outbox, and delivery history.
-- This migration only persists workflow state. It does not send customer messages.

begin;

alter table public.appointments
  add column notification_schedule_generation bigint not null default 0
  check (notification_schedule_generation >= 0);

create or replace function private.bump_notification_schedule_generation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.start_time is distinct from old.start_time
     or new.status is distinct from old.status then
    new.notification_schedule_generation := old.notification_schedule_generation + 1;
  else
    new.notification_schedule_generation := old.notification_schedule_generation;
  end if;
  return new;
end;
$$;

create trigger appointments_bump_notification_schedule_generation
before update on public.appointments
for each row execute function private.bump_notification_schedule_generation();

create table public.client_notification_consent_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  client_id uuid not null,
  channel text not null check (channel in ('email', 'sms')),
  consent_status text not null check (consent_status in ('consented', 'opted_out')),
  event_key uuid not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, event_key),
  foreign key (client_id, tenant_id)
    references public.clients(id, tenant_id) on delete restrict
);

create index client_notification_consent_latest_idx
  on public.client_notification_consent_events
  (tenant_id, client_id, channel, occurred_at desc, created_at desc, id desc);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  appointment_id uuid not null,
  client_id uuid not null,
  appointment_start_time timestamptz not null,
  schedule_generation bigint not null check (schedule_generation >= 0),
  notification_kind text not null
    check (notification_kind in ('confirmation', 'reminder24h', 'reminder2h')),
  channel text not null check (channel in ('email', 'sms')),
  scheduled_for timestamptz not null,
  request_key uuid not null,
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, appointment_id, notification_kind, channel, schedule_generation),
  unique (tenant_id, request_key, notification_kind, channel),
  foreign key (appointment_id, tenant_id)
    references public.appointments(id, tenant_id) on delete restrict,
  foreign key (client_id, tenant_id)
    references public.clients(id, tenant_id) on delete restrict
);

create index notification_outbox_due_idx
  on public.notification_outbox (scheduled_for, tenant_id, id);

create table public.notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  outbox_id uuid not null,
  event_type text not null
    check (event_type in ('claimed', 'delivered', 'retryable', 'failed', 'canceled')),
  attempt_number integer not null check (attempt_number > 0),
  claim_event_id uuid,
  event_key uuid not null,
  retry_after timestamptz,
  lease_expires_at timestamptz,
  error_code text,
  provider_reference text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, event_key),
  unique (id, outbox_id, tenant_id),
  foreign key (outbox_id, tenant_id)
    references public.notification_outbox(id, tenant_id) on delete restrict,
  foreign key (claim_event_id, outbox_id, tenant_id)
    references public.notification_delivery_attempts(id, outbox_id, tenant_id) on delete restrict,
  check (
    (event_type = 'claimed' and claim_event_id is null
      and lease_expires_at is not null and retry_after is null)
    or
    (event_type = 'retryable' and claim_event_id is not null
      and lease_expires_at is null and retry_after is not null)
    or
    (event_type in ('delivered', 'failed', 'canceled') and claim_event_id is not null
      and lease_expires_at is null and retry_after is null)
  ),
  check (error_code is null or error_code ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  check (provider_reference is null or char_length(provider_reference) between 1 and 200)
);

create unique index notification_delivery_claim_result_idx
  on public.notification_delivery_attempts (claim_event_id)
  where claim_event_id is not null;

create index notification_delivery_outbox_history_idx
  on public.notification_delivery_attempts
  (outbox_id, occurred_at desc, created_at desc, id desc);

create or replace function private.reject_notification_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'notification_history_is_append_only';
end;
$$;

create trigger client_notification_consent_reject_mutation
before update or delete on public.client_notification_consent_events
for each row execute function private.reject_notification_history_mutation();

create trigger notification_outbox_reject_mutation
before update or delete on public.notification_outbox
for each row execute function private.reject_notification_history_mutation();

create trigger notification_delivery_attempts_reject_mutation
before update or delete on public.notification_delivery_attempts
for each row execute function private.reject_notification_history_mutation();

alter table public.client_notification_consent_events enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_delivery_attempts enable row level security;

create policy client_notification_consent_tenant_select
on public.client_notification_consent_events for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy notification_outbox_tenant_select
on public.notification_outbox for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy notification_delivery_attempts_tenant_select
on public.notification_delivery_attempts for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

revoke all on public.client_notification_consent_events,
  public.notification_outbox,
  public.notification_delivery_attempts
from public, anon, authenticated, service_role;

grant select on public.client_notification_consent_events,
  public.notification_outbox,
  public.notification_delivery_attempts
to authenticated, service_role;

create or replace function public.record_client_notification_consent(
  target_tenant_id uuid,
  target_client_id uuid,
  target_channel text,
  target_status text,
  target_event_key uuid,
  target_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_event public.client_notification_consent_events%rowtype;
  new_event_id uuid;
begin
  if target_channel not in ('email', 'sms')
     or target_status not in ('consented', 'opted_out')
     or target_event_key is null
     or target_occurred_at is null
     or target_occurred_at > now() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'invalid_notification_consent';
  end if;

  if not exists (
    select 1 from public.clients
    where id = target_client_id and tenant_id = target_tenant_id
  ) then
    raise exception using errcode = '23503', message = 'notification_client_not_found';
  end if;

  insert into public.client_notification_consent_events (
    tenant_id, client_id, channel, consent_status, event_key, occurred_at
  ) values (
    target_tenant_id, target_client_id, target_channel, target_status,
    target_event_key, target_occurred_at
  ) on conflict (tenant_id, event_key) do nothing
  returning id into new_event_id;

  if new_event_id is not null then return new_event_id; end if;

  select * into existing_event
  from public.client_notification_consent_events
  where tenant_id = target_tenant_id and event_key = target_event_key;

  if existing_event.client_id is distinct from target_client_id
     or existing_event.channel is distinct from target_channel
     or existing_event.consent_status is distinct from target_status
     or existing_event.occurred_at is distinct from target_occurred_at then
    raise exception using errcode = '22023', message = 'notification_consent_request_mismatch';
  end if;

  return existing_event.id;
end;
$$;

create or replace function public.schedule_appointment_notifications(
  target_appointment_id uuid,
  target_channel text,
  target_request_key uuid
)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_appointment public.appointments%rowtype;
  selected_client public.clients%rowtype;
  request_replay public.notification_outbox%rowtype;
  existing_request_key uuid;
begin
  if target_channel not in ('email', 'sms') or target_request_key is null then
    raise exception using errcode = '22023', message = 'invalid_notification_channel';
  end if;

  select * into selected_appointment
  from public.appointments
  where id = target_appointment_id
  for share;

  if not found or selected_appointment.status <> 'confirmed' then
    raise exception using errcode = '22023', message = 'notification_appointment_not_confirmed';
  end if;

  select * into selected_client
  from public.clients
  where id = selected_appointment.client_id
    and tenant_id = selected_appointment.tenant_id;

  if not found
     or (target_channel = 'email' and nullif(btrim(selected_client.email), '') is null)
     or (target_channel = 'sms' and nullif(btrim(selected_client.phone), '') is null) then
    raise exception using errcode = '22023', message = 'notification_contact_unavailable';
  end if;

  select * into request_replay
  from public.notification_outbox as outbox
  where outbox.tenant_id = selected_appointment.tenant_id
    and outbox.request_key = target_request_key
    and outbox.channel = target_channel
  limit 1;

  if found and (
    request_replay.appointment_id is distinct from selected_appointment.id
    or request_replay.schedule_generation is distinct from selected_appointment.notification_schedule_generation
  ) then
    raise exception using errcode = '22023', message = 'notification_schedule_request_mismatch';
  end if;

  select outbox.request_key into existing_request_key
  from public.notification_outbox as outbox
  where outbox.tenant_id = selected_appointment.tenant_id
    and outbox.appointment_id = selected_appointment.id
    and outbox.channel = target_channel
    and outbox.schedule_generation = selected_appointment.notification_schedule_generation
  limit 1;

  if found and existing_request_key is distinct from target_request_key then
    raise exception using errcode = '22023', message = 'notification_schedule_request_mismatch';
  end if;

  insert into public.notification_outbox (
    tenant_id, appointment_id, client_id, appointment_start_time, schedule_generation, notification_kind,
    channel, scheduled_for, request_key
  )
  select selected_appointment.tenant_id, selected_appointment.id,
    selected_appointment.client_id, selected_appointment.start_time,
    selected_appointment.notification_schedule_generation, schedule.notification_kind,
    target_channel, schedule.scheduled_for, target_request_key
  from (values
    ('confirmation'::text, now()),
    ('reminder24h'::text, selected_appointment.start_time - interval '24 hours'),
    ('reminder2h'::text, selected_appointment.start_time - interval '2 hours')
  ) as schedule(notification_kind, scheduled_for)
  where schedule.notification_kind = 'confirmation' or schedule.scheduled_for > now()
  on conflict (tenant_id, appointment_id, notification_kind, channel, schedule_generation) do nothing;

  select outbox.request_key into existing_request_key
  from public.notification_outbox as outbox
  where outbox.tenant_id = selected_appointment.tenant_id
    and outbox.appointment_id = selected_appointment.id
    and outbox.channel = target_channel
    and outbox.schedule_generation = selected_appointment.notification_schedule_generation
  limit 1;

  if existing_request_key is distinct from target_request_key then
    raise exception using errcode = '22023', message = 'notification_schedule_request_mismatch';
  end if;

  return query
  select outbox.id
  from public.notification_outbox as outbox
  where outbox.tenant_id = selected_appointment.tenant_id
    and outbox.appointment_id = selected_appointment.id
    and outbox.channel = target_channel
    and outbox.schedule_generation = selected_appointment.notification_schedule_generation
  order by outbox.scheduled_for, outbox.id;
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
    order by event.occurred_at desc, event.created_at desc, event.id desc
    limit 1
  ), latest as (
    select attempt.event_type, attempt.retry_after, attempt.lease_expires_at
    from public.notification_delivery_attempts as attempt
    where attempt.outbox_id = target_outbox_id
    order by attempt.occurred_at desc, attempt.created_at desc, attempt.id desc
    limit 1
  )
  select exists (select 1 from selected)
    and (select consent_status from consent) = 'consented'
    and case
      when not exists (select 1 from latest) then true
      when (select event_type from latest) = 'retryable'
        then (select retry_after from latest) <= evaluated_at
      when (select event_type from latest) = 'claimed'
        then (select lease_expires_at from latest) <= evaluated_at
      else false
    end;
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
    return existing_event.id;
  end if;

  if not private.notification_delivery_eligible(target_outbox_id, target_claimed_at) then
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

create or replace function public.record_notification_delivery_result(
  target_claim_event_id uuid,
  target_result text,
  target_event_key uuid,
  target_occurred_at timestamptz,
  target_retry_after timestamptz default null,
  target_error_code text default null,
  target_provider_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_claim public.notification_delivery_attempts%rowtype;
  existing_event public.notification_delivery_attempts%rowtype;
  latest_claim_id uuid;
  new_event_id uuid;
begin
  if target_result not in ('delivered', 'retryable', 'failed', 'canceled')
     or target_event_key is null
     or target_occurred_at is null
     or target_occurred_at > now() + interval '5 minutes'
     or (target_result = 'retryable' and (target_retry_after is null or target_retry_after <= target_occurred_at))
     or (target_result <> 'retryable' and target_retry_after is not null)
     or (target_error_code is not null and target_error_code !~ '^[a-z0-9][a-z0-9_.-]{0,79}$')
     or (target_provider_reference is not null and char_length(target_provider_reference) not between 1 and 200) then
    raise exception using errcode = '22023', message = 'invalid_notification_result';
  end if;

  select * into selected_claim
  from public.notification_delivery_attempts
  where id = target_claim_event_id and event_type = 'claimed'
  for share;

  if not found then
    raise exception using errcode = '23503', message = 'notification_claim_not_found';
  end if;

  if target_occurred_at < selected_claim.occurred_at then
    raise exception using errcode = '22023', message = 'invalid_notification_result';
  end if;

  perform 1 from public.notification_outbox
  where id = selected_claim.outbox_id
  for update;

  select * into existing_event
  from public.notification_delivery_attempts
  where tenant_id = selected_claim.tenant_id and event_key = target_event_key;

  if found then
    if existing_event.claim_event_id is distinct from target_claim_event_id
       or existing_event.event_type is distinct from target_result
       or existing_event.occurred_at is distinct from target_occurred_at
       or existing_event.retry_after is distinct from target_retry_after
       or existing_event.error_code is distinct from target_error_code
       or existing_event.provider_reference is distinct from target_provider_reference then
      raise exception using errcode = '22023', message = 'notification_result_request_mismatch';
    end if;
    return existing_event.id;
  end if;

  select id into latest_claim_id
  from public.notification_delivery_attempts
  where outbox_id = selected_claim.outbox_id and event_type = 'claimed'
  order by attempt_number desc
  limit 1;

  if latest_claim_id is distinct from selected_claim.id
     or exists (
       select 1 from public.notification_delivery_attempts
       where claim_event_id = selected_claim.id
     ) then
    raise exception using errcode = '55000', message = 'notification_claim_stale_or_completed';
  end if;

  insert into public.notification_delivery_attempts (
    tenant_id, outbox_id, event_type, attempt_number, claim_event_id,
    event_key, retry_after, error_code, provider_reference, occurred_at
  ) values (
    selected_claim.tenant_id, selected_claim.outbox_id, target_result,
    selected_claim.attempt_number, selected_claim.id, target_event_key,
    target_retry_after, target_error_code, target_provider_reference,
    target_occurred_at
  ) returning id into new_event_id;

  return new_event_id;
end;
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

revoke all on function private.reject_notification_history_mutation() from public, anon, authenticated;
revoke all on function private.bump_notification_schedule_generation() from public, anon, authenticated;
revoke all on function private.notification_delivery_eligible(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.record_client_notification_consent(uuid, uuid, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.schedule_appointment_notifications(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.claim_notification_delivery(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.record_notification_delivery_result(uuid, text, uuid, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.get_notification_status_rows(uuid, integer) from public, anon;

grant execute on function public.record_client_notification_consent(uuid, uuid, text, text, uuid, timestamptz) to service_role;
grant execute on function public.schedule_appointment_notifications(uuid, text, uuid) to service_role;
grant execute on function public.claim_notification_delivery(uuid, uuid, timestamptz) to service_role;
grant execute on function public.record_notification_delivery_result(uuid, text, uuid, timestamptz, timestamptz, text, text) to service_role;
grant execute on function public.get_notification_status_rows(uuid, integer) to authenticated;

comment on table public.client_notification_consent_events is
  'Append-only client messaging consent and opt-out evidence. Absence means no recorded consent.';
comment on table public.notification_outbox is
  'Immutable provider-neutral notification schedule. No sender is enabled by this schema.';
comment on table public.notification_delivery_attempts is
  'Append-only claims and outcomes for provider-neutral notification delivery attempts.';

commit;

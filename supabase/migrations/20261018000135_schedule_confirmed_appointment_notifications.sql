-- GLOW-27: persist consented email schedules atomically with appointment changes.
-- No worker, provider, cron, or customer message is enabled here.

begin;

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
  -- This is an internal trigger, not a callable scheduling endpoint. Public
  -- bookings may be anonymous, so the existing appointment mutation path is
  -- the authorization boundary; a direct auth.uid() requirement would break it.
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
    and event.occurred_at <= now()
  order by event.occurred_at desc, event.created_at desc, event.id desc
  limit 1;

  if latest_consent is distinct from 'consented' then return new; end if;

  -- The key is stable for this appointment, schedule generation, and channel.
  -- The existing outbox constraints reject a duplicate revision or drifted key.
  schedule_key := md5(
    'glowflow:g27:email:' || new.id::text || ':' ||
    new.notification_schedule_generation::text
  )::uuid;

  perform public.schedule_appointment_notifications(new.id, 'email', schedule_key);
  return new;
end;
$$;

revoke all on function private.enqueue_confirmed_appointment_email()
from public, anon, authenticated, service_role;

create trigger appointments_enqueue_confirmed_email
after insert or update of start_time, status on public.appointments
for each row execute function private.enqueue_confirmed_appointment_email();

comment on function private.enqueue_confirmed_appointment_email() is
  'Internal trigger only: records consented email schedules; never sends messages.';

commit;

-- GLOW-29 rollback for a failed first deployment.
-- Refuse to discard consent, scheduling, or delivery audit history.

begin;

do $$
begin
  if (to_regclass('public.client_notification_consent_events') is not null
      and exists (select 1 from public.client_notification_consent_events))
     or (to_regclass('public.notification_outbox') is not null
      and exists (select 1 from public.notification_outbox))
     or (to_regclass('public.notification_delivery_attempts') is not null
      and exists (select 1 from public.notification_delivery_attempts)) then
    raise exception using
      errcode = '55000',
      message = 'notification_history_not_empty_preserve_audit_history';
  end if;
end;
$$;

drop function if exists public.record_notification_delivery_result(uuid, text, uuid, timestamptz, timestamptz, text, text);
drop function if exists public.get_notification_status_rows(uuid, integer);
drop function if exists public.claim_notification_delivery(uuid, uuid, timestamptz);
drop function if exists private.notification_delivery_eligible(uuid, timestamptz);
drop function if exists public.schedule_appointment_notifications(uuid, text, uuid);
drop function if exists public.record_client_notification_consent(uuid, uuid, text, text, uuid, timestamptz);
drop table if exists public.notification_delivery_attempts;
drop table if exists public.notification_outbox;
drop table if exists public.client_notification_consent_events;
drop function if exists private.reject_notification_history_mutation();

commit;

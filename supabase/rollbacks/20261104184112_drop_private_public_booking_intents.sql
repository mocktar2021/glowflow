-- GLOW-56 rollback is allowed only while the v2 API gate is disabled, all
-- booking-intent state is empty, and the dependent quota and contract-gate
-- migrations have already been rolled back. Never discard a recovery fence.
begin;

do $$
begin
  if exists (select 1 from private.public_booking_intents)
     or exists (select 1 from private.public_booking_intent_policy)
     or exists (select 1 from private.public_booking_browser_sessions)
     or exists (select 1 from private.public_booking_intent_cleanup_state) then
    raise exception using errcode = '55000', message = 'booking_intent_rows_present_preserve_fence';
  end if;
  if to_regclass('private.public_booking_quota_policy') is not null
     or to_regclass('private.public_booking_quota_counters') is not null
     or to_regclass('private.public_booking_quota_cleanup_state') is not null
     or to_regclass('private.public_booking_contract_gate') is not null
     or to_regprocedure('public.consume_public_booking_quota(text,text,text,text)') is not null
     or to_regprocedure('public.consume_public_booking_capability_quota(text,text,text,text)') is not null
     or to_regprocedure('public.sweep_public_booking_quota_counters(integer)') is not null
     or to_regprocedure('private.require_public_booking_mode(text[])') is not null
     or to_regprocedure('private.transition_public_booking_mode(text,text)') is not null then
    raise exception using errcode = '55000', message = 'booking_intent_rollback_requires_dependents_removed';
  end if;
end;
$$;

drop function public.acknowledge_public_booking_intent(text,text,uuid);
drop function public.sweep_public_booking_intents(integer);
drop function public.cancel_public_booking_intent(text,text,uuid);
drop function public.reconcile_public_booking_intent(text,text,uuid);
drop function public.commit_public_booking_intent(text,text,uuid);
drop function public.prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid);
drop function private.lock_public_booking_browser_session(uuid,text,boolean,boolean);
drop function private.public_booking_intent_confirmation(uuid,uuid,uuid,timestamptz);
drop table private.public_booking_intents;
drop table private.public_booking_browser_sessions;
drop table private.public_booking_intent_policy;
drop table private.public_booking_intent_cleanup_state;

-- The forward intent migration is the only source of this schema grant in
-- the reviewed baseline. Restore the original service-role boundary only
-- after all intent objects and dependent quota/gate objects are gone.
revoke usage on schema private from service_role;

commit;

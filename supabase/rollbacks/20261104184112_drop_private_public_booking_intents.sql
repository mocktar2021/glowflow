-- GLOW-56 rollback is allowed only while the v2 API gate is disabled and no
-- booking intent rows exist. Never discard an unresolved or retained fence.
begin;

do $$
begin
  if exists (select 1 from private.public_booking_intents)
     or exists (select 1 from private.public_booking_intent_policy) then
    raise exception using errcode = '55000', message = 'booking_intent_rows_present_preserve_fence';
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

commit;

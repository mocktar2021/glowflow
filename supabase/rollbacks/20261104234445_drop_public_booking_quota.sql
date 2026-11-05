-- GLOW-56 quota rollback is allowed only while v2 booking remains disabled,
-- the quota has never been configured or consumed, and the dependent contract
-- gate has already been rolled back. Do not erase cleanup evidence.
begin;

do $$
begin
  if exists (select 1 from private.public_booking_quota_policy)
     or exists (select 1 from private.public_booking_quota_counters)
     or exists (select 1 from private.public_booking_quota_cleanup_state) then
    raise exception using errcode = '55000', message = 'booking_quota_rows_present_preserve_limit';
  end if;
  if to_regclass('private.public_booking_contract_gate') is not null
     or to_regprocedure('private.require_public_booking_mode(text[])') is not null
     or to_regprocedure('private.transition_public_booking_mode(text,text)') is not null then
    raise exception using errcode = '55000', message = 'booking_quota_rollback_requires_gate_removed';
  end if;
end;
$$;

drop function public.sweep_public_booking_quota_counters(integer);
drop function public.consume_public_booking_capability_quota(text,text,text,text);
drop function public.consume_public_booking_quota(text,text,text,text);
drop table private.public_booking_quota_counters;
drop table private.public_booking_quota_cleanup_state;
drop table private.public_booking_quota_policy;

commit;

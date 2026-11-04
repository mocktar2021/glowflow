-- GLOW-56 quota rollback is allowed only while v2 booking remains disabled and
-- the quota has never been configured or consumed. Do not erase live counters.
begin;

do $$
begin
  if exists (select 1 from private.public_booking_quota_policy)
     or exists (select 1 from private.public_booking_quota_counters) then
    raise exception using errcode = '55000', message = 'booking_quota_rows_present_preserve_limit';
  end if;
end;
$$;

drop function public.sweep_public_booking_quota_counters(integer);
drop function public.consume_public_booking_quota(text,text,text,text);
drop table private.public_booking_quota_counters;
drop table private.public_booking_quota_cleanup_state;
drop table private.public_booking_quota_policy;

commit;

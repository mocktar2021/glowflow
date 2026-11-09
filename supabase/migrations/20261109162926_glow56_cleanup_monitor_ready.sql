-- GLOW-56: extension-independent readiness predicate for a future cleanup
-- monitor. This does not install pg_cron or pg_net, create a job or Vault
-- secret, send a ping, or turn on booking v2. Hosted application requires
-- separate approval and a fresh GlowFlow-only preflight.
begin;

do $$
begin
  if to_regclass('private.public_booking_intent_cleanup_state') is null
     or to_regclass('private.public_booking_quota_cleanup_state') is null
     or to_regprocedure('public.sweep_public_booking_intents(integer)') is null
     or to_regprocedure('public.sweep_public_booking_quota_counters(integer)') is null then
    raise exception using errcode = '55000',
      message = 'glow56_cleanup_monitor_predecessor_missing';
  end if;
end;
$$;

-- The future monitor may emit a success ping only when BOTH independent
-- full-sweep markers are recent. A partial sweep clears its own marker, and
-- a busy result cannot by itself refresh a marker. The one clock snapshot
-- prevents a caller from supplying a spoofed time or evaluating the two
-- markers against different instants.
create function private.glow56_cleanup_monitor_ready()
returns boolean
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  ready boolean;
begin
  select exists (
    select 1
    from private.public_booking_intent_cleanup_state as intent
    cross join private.public_booking_quota_cleanup_state as quota
    where intent.singleton and quota.singleton
      and intent.last_full_sweep_at is not null
      and quota.last_full_sweep_at is not null
      and intent.last_full_sweep_at <= checked_at
      and quota.last_full_sweep_at <= checked_at
      and intent.last_full_sweep_at > checked_at - interval '10 minutes'
      and quota.last_full_sweep_at > checked_at - interval '10 minutes'
  ) into ready;
  return ready;
end;
$$;
revoke all on function private.glow56_cleanup_monitor_ready()
  from public, anon, authenticated, service_role;
grant execute on function private.glow56_cleanup_monitor_ready()
  to postgres;
comment on function private.glow56_cleanup_monitor_ready() is
  'GLOW-56 dormant monitor predicate. No scheduler, ping, secret, or v2 activation.';

commit;

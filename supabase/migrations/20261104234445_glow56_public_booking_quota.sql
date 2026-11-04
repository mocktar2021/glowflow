-- GLOW-56 dormant, durable quota for public booking v2.
-- No policy rows, schedule, HTTP wiring, or production limit are activated here.
begin;

do $$
begin
  if to_regclass('private.public_booking_intents') is null then
    raise exception using errcode = '55000', message = 'booking_quota_predecessor_missing';
  end if;
end;
$$;

create table private.public_booking_quota_policy (
  action_bucket text primary key check (action_bucket in ('bootstrap', 'prepare', 'reconcile')),
  window_seconds integer not null check (window_seconds between 30 and 3600),
  ip_limit integer not null check (ip_limit between 1 and 1000),
  browser_tenant_limit integer check (browser_tenant_limit between 1 and 1000),
  configured_at timestamptz not null,
  check ((action_bucket = 'bootstrap' and browser_tenant_limit is null)
    or (action_bucket <> 'bootstrap' and browser_tenant_limit is not null))
);
alter table private.public_booking_quota_policy enable row level security;
revoke all on table private.public_booking_quota_policy from public, anon, authenticated;
grant select on table private.public_booking_quota_policy to service_role;
comment on table private.public_booking_quota_policy is
  'GLOW-56 quota values require separate owner approval; this migration seeds no policy row.';

create table private.public_booking_quota_cleanup_state (
  singleton boolean primary key default true check (singleton),
  last_full_sweep_at timestamptz,
  last_run_at timestamptz
);
alter table private.public_booking_quota_cleanup_state enable row level security;
revoke all on table private.public_booking_quota_cleanup_state from public, anon, authenticated;
grant select, insert, update on table private.public_booking_quota_cleanup_state to service_role;

create table private.public_booking_quota_counters (
  action_bucket text not null check (action_bucket in ('bootstrap', 'prepare', 'reconcile')),
  scope text not null check (scope in ('ip', 'browser_tenant')),
  tenant_id uuid not null,
  key_digest text not null check (key_digest ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null check (hits between 1 and 1000000),
  expires_at timestamptz not null,
  primary key (action_bucket, scope, tenant_id, key_digest, window_start),
  check ((scope = 'ip' and tenant_id = '00000000-0000-0000-0000-000000000000'::uuid)
    or (scope = 'browser_tenant' and tenant_id <> '00000000-0000-0000-0000-000000000000'::uuid)),
  check (expires_at > window_start and expires_at <= window_start + interval '24 hours')
);
alter table private.public_booking_quota_counters enable row level security;
revoke all on table private.public_booking_quota_counters from public, anon, authenticated;
grant select, insert, update, delete on table private.public_booking_quota_counters to service_role;
create index public_booking_quota_counters_expiry_idx
  on private.public_booking_quota_counters (expires_at);
comment on table private.public_booking_quota_counters is
  'GLOW-56 pseudonymous HMAC digests only; no raw IP, cookie, or contact data.';

-- Both bucket capacities are checked before either increment. The advisory
-- locks serialize same-key calls across server instances in fixed IP-then-
-- browser order, so a denied browser bucket never burns shared IP capacity.
create function public.consume_public_booking_quota(
  quota_action text, ip_digest text, browser_digest text default null,
  salon_slug text default null
) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  policy private.public_booking_quota_policy%rowtype;
  target_tenant_id uuid;
  zero_tenant_id constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  issued_at timestamptz := pg_catalog.statement_timestamp();
  starts_at timestamptz;
  ends_at timestamptz;
  retry_after integer;
  ip_hits integer;
  browser_hits integer;
begin
  if quota_action is null or quota_action not in ('bootstrap', 'prepare', 'reconcile')
     or ip_digest is null or ip_digest !~ '^[0-9a-f]{64}$'
     or (quota_action = 'bootstrap' and (browser_digest is not null or salon_slug is not null))
     or (quota_action <> 'bootstrap' and (browser_digest is null
       or browser_digest !~ '^[0-9a-f]{64}$'
       or salon_slug is null or pg_catalog.length(pg_catalog.btrim(salon_slug)) not between 2 and 80)) then
    raise exception using errcode = '22023', message = 'booking_quota_invalid_request';
  end if;

  select * into policy from private.public_booking_quota_policy as configured
  where configured.action_bucket = quota_action;
  if not found then
    raise exception using errcode = '55000', message = 'booking_quota_policy_unconfigured';
  end if;

  if quota_action <> 'bootstrap' then
    select tenant.id into target_tenant_id from public.tenants as tenant
    where tenant.slug = pg_catalog.btrim(salon_slug);
    if target_tenant_id is null then
      raise exception using errcode = '22023', message = 'booking_quota_invalid_request';
    end if;
  end if;

  if quota_action in ('bootstrap', 'prepare') and not exists (
    select 1 from private.public_booking_quota_cleanup_state as state
    where state.singleton and state.last_full_sweep_at > issued_at - interval '2 hours'
  ) then
    raise exception using errcode = '55000', message = 'booking_quota_cleanup_stale';
  end if;

  starts_at := pg_catalog.to_timestamp(pg_catalog.floor(
    extract(epoch from issued_at) / policy.window_seconds) * policy.window_seconds);
  ends_at := starts_at + pg_catalog.make_interval(secs => policy.window_seconds);
  retry_after := greatest(1, pg_catalog.ceil(
    extract(epoch from ends_at - issued_at))::integer);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'glowflow:booking-quota:' || quota_action || ':ip:' || ip_digest || ':' || starts_at::text, 0));
  if quota_action <> 'bootstrap' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'glowflow:booking-quota:' || quota_action || ':browser:' || target_tenant_id::text
      || ':' || browser_digest || ':' || starts_at::text, 0));
  end if;

  select counter.hits into ip_hits from private.public_booking_quota_counters as counter
  where counter.action_bucket = quota_action and counter.scope = 'ip'
    and counter.tenant_id = zero_tenant_id and counter.key_digest = ip_digest
    and counter.window_start = starts_at;
  if coalesce(ip_hits, 0) >= policy.ip_limit then
    return pg_catalog.jsonb_build_object('allowed', false, 'retry_after', retry_after);
  end if;

  if quota_action <> 'bootstrap' then
    select counter.hits into browser_hits from private.public_booking_quota_counters as counter
    where counter.action_bucket = quota_action and counter.scope = 'browser_tenant'
      and counter.tenant_id = target_tenant_id and counter.key_digest = browser_digest
      and counter.window_start = starts_at;
    if coalesce(browser_hits, 0) >= policy.browser_tenant_limit then
      return pg_catalog.jsonb_build_object('allowed', false, 'retry_after', retry_after);
    end if;
  end if;

  insert into private.public_booking_quota_counters as counter
    (action_bucket, scope, tenant_id, key_digest, window_start, hits, expires_at)
  values (quota_action, 'ip', zero_tenant_id, ip_digest, starts_at, 1, starts_at + interval '24 hours')
  on conflict (action_bucket, scope, tenant_id, key_digest, window_start)
  do update set hits = counter.hits + 1;

  if quota_action <> 'bootstrap' then
    insert into private.public_booking_quota_counters as counter
      (action_bucket, scope, tenant_id, key_digest, window_start, hits, expires_at)
    values (quota_action, 'browser_tenant', target_tenant_id, browser_digest,
      starts_at, 1, starts_at + interval '24 hours')
    on conflict (action_bucket, scope, tenant_id, key_digest, window_start)
    do update set hits = counter.hits + 1;
  end if;

  return pg_catalog.jsonb_build_object('allowed', true, 'retry_after', 0);
end;
$$;
revoke all on function public.consume_public_booking_quota(text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_public_booking_quota(text,text,text,text) to service_role;

-- No cron job is installed. A separately reviewed, bounded operator job must
-- keep this full-sweep signal fresh before new cookies or preparations work.
create function public.sweep_public_booking_quota_counters(batch_limit integer default 100)
returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  removed integer;
  remaining boolean;
begin
  if batch_limit is null or batch_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'booking_quota_cleanup_invalid_limit';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('glowflow:public-booking-quota-cleanup', 0)) then
    return pg_catalog.jsonb_build_object('complete', false, 'busy', true);
  end if;

  insert into private.public_booking_quota_cleanup_state
    (singleton, last_full_sweep_at, last_run_at)
  values (true, null, pg_catalog.clock_timestamp())
  on conflict (singleton) do update
    set last_full_sweep_at = null, last_run_at = excluded.last_run_at;

  with candidate as (
    select counter.ctid from private.public_booking_quota_counters as counter
    where counter.expires_at <= pg_catalog.clock_timestamp()
    order by counter.expires_at
    limit batch_limit for update skip locked
  ), deleted as (
    delete from private.public_booking_quota_counters as counter
    using candidate where counter.ctid = candidate.ctid returning 1
  ) select pg_catalog.count(*)::integer into removed from deleted;

  select exists (select 1 from private.public_booking_quota_counters as counter
    where counter.expires_at <= pg_catalog.clock_timestamp()) into remaining;
  if not remaining then
    update private.public_booking_quota_cleanup_state
    set last_full_sweep_at = pg_catalog.clock_timestamp()
    where singleton;
  end if;
  return pg_catalog.jsonb_build_object('complete', not remaining, 'removed', removed);
end;
$$;
revoke all on function public.sweep_public_booking_quota_counters(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sweep_public_booking_quota_counters(integer) to service_role;

commit;

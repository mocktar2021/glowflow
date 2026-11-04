-- GLOW-56: dormant same-browser public booking intent contract.
-- No policy row is installed here. A separate privacy/operations decision and
-- hosted approval are required before prepare can create any intent.
begin;

do $$
begin
  if to_regprocedure('public.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)') is null
     or to_regclass('public.appointments') is null
     or to_regclass('public.salon_public_profiles') is null then
    raise exception using errcode = '55000', message = 'booking_intent_predecessor_missing';
  end if;
end;
$$;

create table private.public_booking_intent_policy (
  singleton boolean primary key default true check (singleton),
  prepared_ttl interval not null check (prepared_ttl = interval '2 hours'),
  retention_ttl interval not null check (retention_ttl = interval '3 days'),
  configured_at timestamptz not null
);
alter table private.public_booking_intent_policy enable row level security;
revoke all on table private.public_booking_intent_policy from public, anon, authenticated;
grant select on table private.public_booking_intent_policy to service_role;
comment on table private.public_booking_intent_policy is
  'GLOW-56 dormant policy. Owner chose 2-hour preparation and 3-day terminal retention; no row is seeded or hosted activation approved.';

create table private.public_booking_intent_cleanup_state (
  singleton boolean primary key default true check (singleton),
  last_full_sweep_at timestamptz,
  last_run_at timestamptz
);
alter table private.public_booking_intent_cleanup_state enable row level security;
revoke all on table private.public_booking_intent_cleanup_state from public, anon, authenticated;
grant select, insert, update on table private.public_booking_intent_cleanup_state to service_role;

create table private.public_booking_browser_sessions (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  browser_token_hash text not null check (browser_token_hash ~ '^[0-9a-f]{64}$'),
  generation uuid not null default pg_catalog.gen_random_uuid(),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null default pg_catalog.clock_timestamp() + interval '24 hours',
  check (expires_at > created_at),
  primary key (tenant_id, browser_token_hash)
);
alter table private.public_booking_browser_sessions enable row level security;
revoke all on table private.public_booking_browser_sessions from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update on table private.public_booking_browser_sessions to service_role;
grant delete on table private.public_booking_browser_sessions to service_role;
create index public_booking_browser_sessions_updated_idx
  on private.public_booking_browser_sessions (updated_at);
comment on table private.public_booking_browser_sessions is
  'GLOW-56 server-side generation fence for delayed stale-tab prepare requests; no contact data or raw cookie.';

create table private.public_booking_intents (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  browser_token_hash text not null check (browser_token_hash ~ '^[0-9a-f]{64}$'),
  request_key uuid not null default pg_catalog.gen_random_uuid(),
  state text not null default 'prepared'
    check (state in ('prepared', 'committed', 'canceled', 'expired')),
  service_id uuid not null,
  staff_id uuid not null,
  requested_start timestamptz not null,
  client_locale text not null check (client_locale in ('fr', 'en', 'es')),
  client_full_name text,
  client_phone text,
  client_email text,
  appointment_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  terminal_at timestamptz,
  acknowledged_at timestamptz,
  released_generation uuid,
  unique (tenant_id, request_key),
  foreign key (tenant_id, browser_token_hash)
    references private.public_booking_browser_sessions(tenant_id, browser_token_hash) on delete restrict,
  foreign key (appointment_id, tenant_id)
    references public.appointments(id, tenant_id) on delete restrict,
  check (expires_at > created_at),
  check (
    (state = 'prepared' and appointment_id is null and terminal_at is null
      and acknowledged_at is null and released_generation is null
      and client_full_name is not null
      and (client_phone is not null or client_email is not null))
    or (state = 'committed' and appointment_id is not null and terminal_at is not null
      and ((acknowledged_at is null and released_generation is null)
        or (acknowledged_at is not null and released_generation is not null))
      and client_full_name is null and client_phone is null and client_email is null)
    or (state in ('canceled', 'expired') and appointment_id is null
      and terminal_at is not null and acknowledged_at is null
      and released_generation is not null
      and client_full_name is null and client_phone is null and client_email is null)
  )
);
create unique index public_booking_intents_active_browser_tenant_idx
  on private.public_booking_intents (browser_token_hash, tenant_id)
  where state = 'prepared' or (state = 'committed' and acknowledged_at is null);
create index public_booking_intents_browser_history_idx
  on private.public_booking_intents (browser_token_hash, tenant_id, created_at desc);
create index public_booking_intents_prepared_expiry_idx
  on private.public_booking_intents (least(expires_at, requested_start))
  where state = 'prepared';
create index public_booking_intents_terminal_retention_idx
  on private.public_booking_intents (terminal_at)
  where state <> 'prepared';
alter table private.public_booking_intents enable row level security;
revoke all on table private.public_booking_intents from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update on table private.public_booking_intents to service_role;
grant delete on table private.public_booking_intents to service_role;
comment on table private.public_booking_intents is
  'GLOW-56 private immutable-payload intent. Contact fields exist only while prepared and are scrubbed on terminal transition.';

-- Committed replay must read the stored appointment before current catalog,
-- publication, or requested-start validation. The request key is part of the
-- lookup so a mismatched appointment or changed start can never be reported as confirmation.
create function private.public_booking_intent_confirmation(
  target_tenant_id uuid, target_appointment_id uuid, target_request_key uuid,
  target_requested_start timestamptz
) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'appointment_id', appointment.id,
    'confirmed_start', appointment.start_time,
    'confirmed_end', appointment.end_time,
    'salon_name', tenant.name,
    'service_title', appointment.service_title_json,
    'currency', tenant.currency,
    'saved_locale', appointment.booking_locale,
    'appointment_status', appointment.status
  )
  from public.appointments as appointment
  join public.tenants as tenant on tenant.id = appointment.tenant_id
  where appointment.id = target_appointment_id
    and appointment.tenant_id = target_tenant_id
    and appointment.public_booking_request_key = target_request_key
    and appointment.start_time = target_requested_start;
$$;
revoke all on function private.public_booking_intent_confirmation(uuid,uuid,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function private.public_booking_intent_confirmation(uuid,uuid,uuid,timestamptz)
  to service_role;

-- Shared lock order: browser advisory lock, browser-session row, intent row.
-- The commit path uses this helper too, so expiry can rotate the generation
-- without racing prepare or cancellation. A new browser session is created
-- only by a no-ID reconcile, never by a delayed prepare or commit.
create function private.lock_public_booking_browser_session(
  target_tenant_id uuid, target_browser_hash text, bootstrap boolean,
  allow_expired boolean default false
) returns uuid
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  current_generation uuid;
  session_expires_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    target_tenant_id::text || ':booking-intent:' || target_browser_hash, 0));
  select session.generation, session.expires_at
  into current_generation, session_expires_at
  from private.public_booking_browser_sessions as session
  where session.tenant_id = target_tenant_id
    and session.browser_token_hash = target_browser_hash
  for update;
  if not found and bootstrap then
    insert into private.public_booking_browser_sessions (tenant_id, browser_token_hash)
    values (target_tenant_id, target_browser_hash)
    returning generation into current_generation;
  end if;
  if not allow_expired and session_expires_at <= pg_catalog.clock_timestamp() then
    return null;
  end if;
  return current_generation;
end;
$$;
revoke all on function private.lock_public_booking_browser_session(uuid,text,boolean,boolean)
  from public, anon, authenticated;
grant execute on function private.lock_public_booking_browser_session(uuid,text,boolean,boolean)
  to service_role;

-- An external, separately approved scheduler may call this bounded RPC as
-- service_role. The migration installs no cron job, route, policy row or worker.
-- Candidate selection is deliberately unlocked; each candidate is rechecked
-- after taking the shared advisory -> browser session -> intent lock order.
create function public.sweep_public_booking_intents(batch_limit integer default 50)
returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  candidate record;
  stored private.public_booking_intents%rowtype;
  current_generation uuid;
  processed integer := 0;
  scrubbed integer := 0;
  purged integer := 0;
  sessions_purged integer := 0;
  remaining boolean;
begin
  if batch_limit is null or batch_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'booking_intent_cleanup_invalid_limit';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('glowflow:public-booking-intent-cleanup', 0)) then
    return pg_catalog.jsonb_build_object('complete', false, 'busy', true);
  end if;

  -- A partial or failed sweep never refreshes the gate for new preparations.
  insert into private.public_booking_intent_cleanup_state
    (singleton, last_full_sweep_at, last_run_at)
  values (true, null, pg_catalog.clock_timestamp())
  on conflict (singleton) do update
    set last_full_sweep_at = null, last_run_at = excluded.last_run_at;

  for candidate in
    select row.id, row.tenant_id, row.browser_token_hash
    from private.public_booking_intents as row
    where (row.state = 'prepared'
      and least(row.expires_at, row.requested_start) <= pg_catalog.clock_timestamp())
      or (row.state <> 'prepared'
        and row.terminal_at <= pg_catalog.clock_timestamp() - interval '3 days')
    -- Expired prepared contact PII takes priority over older tombstones, so
    -- retention backlog cannot starve the privacy scrub under a small batch.
    order by case when row.state = 'prepared' then 0 else 1 end,
      case when row.state = 'prepared'
        then least(row.expires_at, row.requested_start) else row.terminal_at end,
      row.id
    limit batch_limit
  loop
    current_generation := private.lock_public_booking_browser_session(
      candidate.tenant_id, candidate.browser_token_hash, false, true);
    if current_generation is null then
      raise exception using errcode = '55000', message = 'booking_intent_cleanup_session_missing';
    end if;
    select * into stored from private.public_booking_intents as row
    where row.id = candidate.id for update;
    if not found then continue; end if;

    if stored.state = 'prepared'
       and least(stored.expires_at, stored.requested_start) <= pg_catalog.clock_timestamp() then
      update private.public_booking_browser_sessions as session
      set generation = pg_catalog.gen_random_uuid(), updated_at = pg_catalog.clock_timestamp()
      where session.tenant_id = stored.tenant_id
        and session.browser_token_hash = stored.browser_token_hash
      returning generation into current_generation;
      update private.public_booking_intents as row
      set state = 'expired', terminal_at = pg_catalog.clock_timestamp(),
          released_generation = current_generation,
          client_full_name = null, client_phone = null, client_email = null
      where row.id = stored.id;
      scrubbed := scrubbed + 1;
      processed := processed + 1;
    elsif stored.state <> 'prepared'
       and stored.terminal_at <= pg_catalog.clock_timestamp() - interval '3 days' then
      delete from private.public_booking_intents as row where row.id = stored.id;
      purged := purged + 1;
      processed := processed + 1;
    end if;
  end loop;

  -- Browser hashes outlive the 24-hour cookie but not the 3-day grace once
  -- every related intent tombstone has been purged. Recheck after the lock.
  if processed < batch_limit then
    for candidate in
      select session.tenant_id, session.browser_token_hash
      from private.public_booking_browser_sessions as session
      where session.updated_at <= pg_catalog.clock_timestamp() - interval '3 days'
        and session.expires_at <= pg_catalog.clock_timestamp()
        and not exists (select 1 from private.public_booking_intents as row
          where row.tenant_id = session.tenant_id
            and row.browser_token_hash = session.browser_token_hash)
      order by session.updated_at, session.tenant_id, session.browser_token_hash
      limit batch_limit - processed
    loop
      current_generation := private.lock_public_booking_browser_session(
        candidate.tenant_id, candidate.browser_token_hash, false, true);
      if current_generation is not null then
        delete from private.public_booking_browser_sessions as session
        where session.tenant_id = candidate.tenant_id
          and session.browser_token_hash = candidate.browser_token_hash
          and session.updated_at <= pg_catalog.clock_timestamp() - interval '3 days'
          and session.expires_at <= pg_catalog.clock_timestamp()
          and not exists (select 1 from private.public_booking_intents as row
            where row.tenant_id = session.tenant_id
              and row.browser_token_hash = session.browser_token_hash);
        if found then
          sessions_purged := sessions_purged + 1;
          processed := processed + 1;
        end if;
      end if;
    end loop;
  end if;

  select exists (
    select 1 from private.public_booking_intents as row
    where (row.state = 'prepared'
      and least(row.expires_at, row.requested_start) <= pg_catalog.clock_timestamp())
      or (row.state <> 'prepared'
        and row.terminal_at <= pg_catalog.clock_timestamp() - interval '3 days')
  ) or exists (
    select 1 from private.public_booking_browser_sessions as session
    where session.updated_at <= pg_catalog.clock_timestamp() - interval '3 days'
      and session.expires_at <= pg_catalog.clock_timestamp()
      and not exists (select 1 from private.public_booking_intents as row
        where row.tenant_id = session.tenant_id
          and row.browser_token_hash = session.browser_token_hash)
  ) into remaining;
  if not remaining then
    update private.public_booking_intent_cleanup_state
    set last_full_sweep_at = pg_catalog.clock_timestamp()
    where singleton;
  end if;
  return pg_catalog.jsonb_build_object('complete', not remaining,
    'busy', false, 'scrubbed', scrubbed, 'purged', purged,
    'sessions_purged', sessions_purged);
end;
$$;
revoke all on function public.sweep_public_booking_intents(integer)
  from public, anon, authenticated;
grant execute on function public.sweep_public_booking_intents(integer)
  to service_role;

create function public.prepare_public_booking_intent(
  salon_slug text, browser_token_hash text, service_id uuid, staff_id uuid,
  requested_start timestamptz, client_full_name text, client_phone text,
  client_email text, client_locale text, expected_generation uuid
) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  selected_tenant_id uuid;
  input_hash text := browser_token_hash;
  current_generation uuid;
  existing private.public_booking_intents%rowtype;
  normalized_name text := pg_catalog.btrim(client_full_name);
  normalized_phone text := nullif(pg_catalog.btrim(client_phone), '');
  normalized_email text := nullif(pg_catalog.lower(pg_catalog.btrim(client_email)), '');
  new_id uuid;
  ttl interval;
  issued_at timestamptz;
  stored_confirmation jsonb;
begin
  if browser_token_hash is null or browser_token_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;

  select tenant.id into selected_tenant_id
  from public.tenants as tenant where tenant.slug = pg_catalog.btrim(salon_slug);
  if selected_tenant_id is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;

  current_generation := private.lock_public_booking_browser_session(
    selected_tenant_id, input_hash, false);
  if current_generation is null or expected_generation is distinct from current_generation then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  select * into existing from private.public_booking_intents as intent
  where intent.tenant_id = selected_tenant_id
    and intent.browser_token_hash = input_hash
    and (intent.state = 'prepared'
      or (intent.state = 'committed' and intent.acknowledged_at is null))
  order by intent.created_at desc, intent.id
  limit 1 for update;

  if found then
    if existing.state = 'committed' then
      stored_confirmation := private.public_booking_intent_confirmation(
        existing.tenant_id, existing.appointment_id, existing.request_key,
        existing.requested_start);
      if stored_confirmation is null then
        return pg_catalog.jsonb_build_object('state', 'unknown');
      end if;
      return pg_catalog.jsonb_build_object('state', 'confirmed',
        'intent_id', existing.id, 'generation', current_generation,
        'confirmation', stored_confirmation);
    end if;
    if pg_catalog.clock_timestamp() >= least(existing.expires_at, existing.requested_start) then
      update private.public_booking_browser_sessions as session
      set generation = pg_catalog.gen_random_uuid(), updated_at = pg_catalog.clock_timestamp()
      where session.tenant_id = selected_tenant_id and session.browser_token_hash = input_hash
      returning generation into current_generation;
      update private.public_booking_intents as intent
      set state = 'expired', terminal_at = pg_catalog.clock_timestamp(),
          released_generation = current_generation,
          client_full_name = null, client_phone = null, client_email = null
      where intent.id = existing.id;
      return pg_catalog.jsonb_build_object('state', 'not_committed',
        'intent_id', existing.id, 'generation', current_generation, 'reason', 'expired');
    elsif existing.service_id = service_id and existing.staff_id = staff_id
       and existing.requested_start = requested_start
       and existing.client_full_name = normalized_name
       and existing.client_phone is not distinct from normalized_phone
       and existing.client_email is not distinct from normalized_email
       and existing.client_locale = client_locale then
      return pg_catalog.jsonb_build_object('state', 'prepared',
        'intent_id', existing.id, 'generation', current_generation);
    else
      return pg_catalog.jsonb_build_object('state', 'unknown');
    end if;
  end if;

  -- Recovery above must not depend on today's catalog/publication. New
  -- preparations, however, require valid contact and a published salon.
  if normalized_name is null or pg_catalog.char_length(normalized_name) not between 2 and 120
     or (normalized_phone is null and normalized_email is null)
     or pg_catalog.char_length(normalized_phone) > 40
     or pg_catalog.char_length(normalized_email) > 160
     or (normalized_email is not null and normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
     or client_locale is null or client_locale not in ('fr', 'en', 'es')
     or requested_start is null
     or requested_start <= pg_catalog.clock_timestamp()
     or requested_start > pg_catalog.clock_timestamp() + interval '90 days'
     or not exists (
       select 1 from public.tenants as tenant
       join public.markets as market on market.country_code = tenant.country_code
       join public.services as service on service.tenant_id = tenant.id
       where tenant.id = selected_tenant_id
         and tenant.is_booking_enabled and market.status = 'active'
         and service.id = service_id and service.is_active
         and exists (select 1 from public.salon_public_profiles as profile
           where profile.tenant_id = tenant.id and profile.is_published)
         and exists (select 1 from public.users as staff
           where staff.id = staff_id and staff.tenant_id = tenant.id)
     ) then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;

  select policy.prepared_ttl into ttl
  from private.public_booking_intent_policy as policy where policy.singleton;
  if ttl is null then
    raise exception using errcode = '55000', message = 'booking_intent_policy_unconfigured';
  end if;
  if not exists (
    select 1 from private.public_booking_intent_cleanup_state as cleanup
    where cleanup.singleton
      and cleanup.last_full_sweep_at >= pg_catalog.clock_timestamp() - interval '2 hours'
  ) then
    raise exception using errcode = '55000', message = 'booking_intent_cleanup_stale';
  end if;
  issued_at := pg_catalog.clock_timestamp();
  insert into private.public_booking_intents (
    tenant_id, browser_token_hash, service_id, staff_id, requested_start,
    client_locale, client_full_name, client_phone, client_email, created_at, expires_at
  ) values (
    selected_tenant_id, browser_token_hash, service_id, staff_id, requested_start,
    client_locale, normalized_name, normalized_phone, normalized_email,
    issued_at, least(issued_at + ttl, requested_start)
  ) returning id into new_id;
  return pg_catalog.jsonb_build_object('state', 'prepared',
    'intent_id', new_id, 'generation', current_generation);
end;
$$;
revoke all on function public.prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  to service_role;

create function public.commit_public_booking_intent(
  salon_slug text, browser_token_hash text, intent_id uuid
) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  selected_tenant_id uuid;
  input_hash text := browser_token_hash;
  current_generation uuid;
  intent private.public_booking_intents%rowtype;
  booked record;
  stored_confirmation jsonb;
begin
  if browser_token_hash is null or browser_token_hash !~ '^[0-9a-f]{64}$'
     or intent_id is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  select id into selected_tenant_id from public.tenants
    where slug = pg_catalog.btrim(salon_slug);
  if selected_tenant_id is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  current_generation := private.lock_public_booking_browser_session(
    selected_tenant_id, input_hash, false);
  if current_generation is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  select * into intent from private.public_booking_intents as stored
  where stored.id = intent_id and stored.tenant_id = selected_tenant_id
    and stored.browser_token_hash = input_hash
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  if intent.state = 'committed' then
    stored_confirmation := private.public_booking_intent_confirmation(
      intent.tenant_id, intent.appointment_id, intent.request_key,
      intent.requested_start);
    if stored_confirmation is null then
      return pg_catalog.jsonb_build_object('state', 'unknown');
    end if;
    return pg_catalog.jsonb_build_object('state', 'confirmed',
      'intent_id', intent.id,
      'generation', coalesce(intent.released_generation, current_generation),
      'confirmation', stored_confirmation);
  end if;
  if intent.state in ('canceled', 'expired') then
    return pg_catalog.jsonb_build_object('state', 'not_committed',
      'intent_id', intent.id, 'generation', intent.released_generation, 'reason', intent.state);
  end if;
  -- Check real wall time after the row lock, not transaction-start now().
  if pg_catalog.clock_timestamp() >= intent.expires_at
     or pg_catalog.clock_timestamp() >= intent.requested_start then
    update private.public_booking_browser_sessions as session
    set generation = pg_catalog.gen_random_uuid(), updated_at = pg_catalog.clock_timestamp()
    where session.tenant_id = selected_tenant_id and session.browser_token_hash = input_hash
    returning generation into current_generation;
    update private.public_booking_intents as stored
    set state = 'expired', terminal_at = pg_catalog.clock_timestamp(),
        released_generation = current_generation,
        client_full_name = null, client_phone = null, client_email = null
    where stored.id = intent.id;
    return pg_catalog.jsonb_build_object('state', 'not_committed',
      'intent_id', intent.id, 'generation', current_generation, 'reason', 'expired');
  end if;

  begin
    select * into booked from public.create_public_appointment(
      salon_slug, intent.service_id, intent.staff_id, intent.requested_start,
      intent.client_full_name, intent.client_phone, intent.client_email,
      intent.client_locale, intent.request_key);
  exception
    when exclusion_violation or invalid_parameter_value or foreign_key_violation then
      -- One failed invocation is not permission to change payload. A later
      -- commit still uses this same row/key, or cancel can fence it first.
      return pg_catalog.jsonb_build_object('state', 'unknown',
        'intent_id', intent.id, 'reason', 'booking_unavailable');
  end;
  if booked.appointment_id is null then
    raise exception using errcode = '55000', message = 'booking_intent_missing_confirmation';
  end if;
  update private.public_booking_intents as stored
  set state = 'committed', appointment_id = booked.appointment_id,
      terminal_at = pg_catalog.clock_timestamp(),
      client_full_name = null, client_phone = null, client_email = null
  where stored.id = intent.id;
  stored_confirmation := private.public_booking_intent_confirmation(
    intent.tenant_id, booked.appointment_id, intent.request_key,
    intent.requested_start);
  if stored_confirmation is null then
    raise exception using errcode = '55000', message = 'booking_intent_missing_confirmation';
  end if;
  return pg_catalog.jsonb_build_object('state', 'confirmed',
    'intent_id', intent.id, 'generation', current_generation,
    'confirmation', stored_confirmation);
end;
$$;
revoke all on function public.commit_public_booking_intent(text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.commit_public_booking_intent(text,text,uuid)
  to service_role;

create function public.reconcile_public_booking_intent(
  salon_slug text, browser_token_hash text, intent_id uuid default null
) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  selected_tenant_id uuid;
  input_hash text := browser_token_hash;
  current_generation uuid;
  intent private.public_booking_intents%rowtype;
  stored_confirmation jsonb;
begin
  if browser_token_hash is null or browser_token_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  select id into selected_tenant_id from public.tenants
    where slug = pg_catalog.btrim(salon_slug);
  if selected_tenant_id is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  current_generation := private.lock_public_booking_browser_session(
    selected_tenant_id, input_hash, intent_id is null);
  if current_generation is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  if intent_id is not null then
    select * into intent from private.public_booking_intents as stored
    where stored.id = intent_id and stored.tenant_id = selected_tenant_id
      and stored.browser_token_hash = input_hash
    for update;
    if not found then
      return pg_catalog.jsonb_build_object('state', 'unknown');
    end if;
  else
    select * into intent from private.public_booking_intents as stored
    where stored.tenant_id = selected_tenant_id
      and stored.browser_token_hash = input_hash
      and (stored.state = 'prepared'
        or (stored.state = 'committed' and stored.acknowledged_at is null))
    order by stored.created_at desc, stored.id limit 1 for update;
    if not found then
      -- Exact-ID markers recover terminal results above. Without a known ID,
      -- an old tombstone must not supply a stale released generation.
      return pg_catalog.jsonb_build_object('state', 'none',
        'generation', current_generation);
    end if;
  end if;
  if intent.state = 'prepared' and pg_catalog.clock_timestamp() >= least(intent.expires_at, intent.requested_start) then
    update private.public_booking_browser_sessions as session
    set generation = pg_catalog.gen_random_uuid(), updated_at = pg_catalog.clock_timestamp()
    where session.tenant_id = selected_tenant_id and session.browser_token_hash = input_hash
    returning generation into current_generation;
    update private.public_booking_intents as stored
    set state = 'expired', terminal_at = pg_catalog.clock_timestamp(),
        released_generation = current_generation,
        client_full_name = null, client_phone = null, client_email = null
    where stored.id = intent.id;
    return pg_catalog.jsonb_build_object('state', 'not_committed',
      'intent_id', intent.id, 'generation', current_generation, 'reason', 'expired');
  end if;
  if intent.state = 'prepared' then
    return pg_catalog.jsonb_build_object('state', 'prepared',
      'intent_id', intent.id, 'generation', current_generation);
  end if;
  if intent.state in ('canceled', 'expired') then
    return pg_catalog.jsonb_build_object('state', 'not_committed',
      'intent_id', intent.id, 'generation', intent.released_generation, 'reason', intent.state);
  end if;
  stored_confirmation := private.public_booking_intent_confirmation(
    intent.tenant_id, intent.appointment_id, intent.request_key,
    intent.requested_start);
  if stored_confirmation is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  return pg_catalog.jsonb_build_object('state', 'confirmed',
    'intent_id', intent.id,
    'generation', coalesce(intent.released_generation, current_generation),
    'confirmation', stored_confirmation);
end;
$$;
revoke all on function public.reconcile_public_booking_intent(text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_public_booking_intent(text,text,uuid)
  to service_role;

create function public.cancel_public_booking_intent(
  salon_slug text, browser_token_hash text, intent_id uuid
) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  selected_tenant_id uuid;
  input_hash text := browser_token_hash;
  current_generation uuid;
  intent private.public_booking_intents%rowtype;
  stored_confirmation jsonb;
  terminal_state text;
begin
  if browser_token_hash is null or browser_token_hash !~ '^[0-9a-f]{64}$'
     or intent_id is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  select id into selected_tenant_id from public.tenants
    where slug = pg_catalog.btrim(salon_slug);
  if selected_tenant_id is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  current_generation := private.lock_public_booking_browser_session(
    selected_tenant_id, input_hash, false);
  if current_generation is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  select * into intent from private.public_booking_intents as stored
  where stored.id = intent_id and stored.tenant_id = selected_tenant_id
    and stored.browser_token_hash = input_hash
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  if intent.state = 'committed' then
    stored_confirmation := private.public_booking_intent_confirmation(
      intent.tenant_id, intent.appointment_id, intent.request_key,
      intent.requested_start);
    if stored_confirmation is null then
      return pg_catalog.jsonb_build_object('state', 'unknown');
    end if;
    return pg_catalog.jsonb_build_object('state', 'confirmed',
      'intent_id', intent.id,
      'generation', coalesce(intent.released_generation, current_generation),
      'confirmation', stored_confirmation);
  end if;
  if intent.state in ('canceled', 'expired') then
    return pg_catalog.jsonb_build_object('state', 'not_committed',
      'intent_id', intent.id, 'generation', intent.released_generation, 'reason', intent.state);
  end if;
  terminal_state := case when pg_catalog.clock_timestamp() >= least(intent.expires_at, intent.requested_start)
    then 'expired' else 'canceled' end;
  update private.public_booking_browser_sessions as session
  set generation = pg_catalog.gen_random_uuid(), updated_at = pg_catalog.clock_timestamp()
  where session.tenant_id = selected_tenant_id and session.browser_token_hash = input_hash
  returning generation into current_generation;
  update private.public_booking_intents as stored
  set state = terminal_state, terminal_at = pg_catalog.clock_timestamp(),
      released_generation = current_generation,
      client_full_name = null, client_phone = null, client_email = null
  where stored.id = intent.id;
  return pg_catalog.jsonb_build_object('state', 'not_committed',
    'intent_id', intent.id, 'generation', current_generation, 'reason', terminal_state);
end;
$$;
revoke all on function public.cancel_public_booking_intent(text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_public_booking_intent(text,text,uuid)
  to service_role;

create function public.acknowledge_public_booking_intent(
  salon_slug text, browser_token_hash text, intent_id uuid
) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  selected_tenant_id uuid;
  input_hash text := browser_token_hash;
  current_generation uuid;
  intent private.public_booking_intents%rowtype;
begin
  if browser_token_hash is null or browser_token_hash !~ '^[0-9a-f]{64}$'
     or intent_id is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  select id into selected_tenant_id from public.tenants
    where slug = pg_catalog.btrim(salon_slug);
  if selected_tenant_id is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  current_generation := private.lock_public_booking_browser_session(
    selected_tenant_id, input_hash, false);
  if current_generation is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  select * into intent from private.public_booking_intents as stored
  where stored.id = intent_id and stored.tenant_id = selected_tenant_id
    and stored.browser_token_hash = input_hash
  for update;
  if not found or intent.state <> 'committed' then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  if intent.acknowledged_at is null then
    update private.public_booking_browser_sessions as session
    set generation = pg_catalog.gen_random_uuid(), updated_at = pg_catalog.clock_timestamp()
    where session.tenant_id = selected_tenant_id and session.browser_token_hash = input_hash
    returning generation into current_generation;
    update private.public_booking_intents as stored
    set acknowledged_at = pg_catalog.clock_timestamp(),
        released_generation = current_generation
    where stored.id = intent.id;
  else
    current_generation := intent.released_generation;
  end if;
  return pg_catalog.jsonb_build_object('state', 'none',
    'generation', current_generation);
end;
$$;
revoke all on function public.acknowledge_public_booking_intent(text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.acknowledge_public_booking_intent(text,text,uuid)
  to service_role;

commit;

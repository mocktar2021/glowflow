-- GLOW-56 dormant booking contract gate. This migration is code only until a
-- separate, fresh GlowFlow-only hosted preflight and owner approval.
-- It installs a legacy-mode gate that keeps the existing v1 booking RPC open,
-- but never seeds v2 policy, schedules cleanup, or enables a feature flag.
-- Scope: named booking RPCs and direct service_role DML to private intent and
-- session tables. Arbitrary privileged direct public appointment/client writes
-- remain outside this gate and require a hosted ACL/credential preflight.

begin;

do $$
begin
  if to_regclass('private.public_booking_intents') is null
     or to_regclass('private.public_booking_quota_policy') is null
     or to_regprocedure('public.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)') is null
     or to_regprocedure('public.prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)') is null
     or to_regprocedure('public.commit_public_booking_intent(text,text,uuid)') is null
     or to_regprocedure('public.reconcile_public_booking_intent(text,text,uuid)') is null
     or to_regprocedure('public.cancel_public_booking_intent(text,text,uuid)') is null
     or to_regprocedure('public.acknowledge_public_booking_intent(text,text,uuid)') is null then
    raise exception using errcode = '55000', message = 'booking_contract_predecessor_missing';
  end if;
  if to_regclass('private.public_booking_contract_gate') is not null then
    raise exception using errcode = '55000', message = 'booking_contract_gate_already_exists';
  end if;
  if exists (select 1 from private.public_booking_intents)
     or exists (select 1 from private.public_booking_intent_policy) then
    raise exception using errcode = '55000', message = 'booking_contract_requires_empty_dormant_intents';
  end if;
end;
$$;


create table private.public_booking_contract_gate (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'legacy'
    check (mode in ('legacy', 'frozen', 'v2', 'v2_no_prepares')),
  ever_v2 boolean not null default false,
  changed_at timestamptz not null default clock_timestamp(),
  check (not (mode in ('v2', 'v2_no_prepares') and not ever_v2)),
  check (not (mode = 'legacy' and ever_v2))
);
alter table private.public_booking_contract_gate enable row level security;
revoke all on private.public_booking_contract_gate from public, anon, authenticated, service_role;
insert into private.public_booking_contract_gate (singleton, mode, ever_v2)
values (true, 'legacy', false);

-- FOR SHARE conflicts with the transition's UPDATE and is held until the
-- caller's transaction ends. Public wrappers invoke this before any other lock.
create function private.require_public_booking_mode(allowed_modes text[])
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare current_mode text;
begin
  select gate.mode into current_mode
  from private.public_booking_contract_gate as gate
  where gate.singleton for share;
  if current_mode is null or not (current_mode = any(allowed_modes)) then
    raise exception using errcode = '55000', message = 'booking_contract_closed';
  end if;
  return current_mode;
end;
$$;
revoke all on function private.require_public_booking_mode(text[])
  from public, anon, authenticated, service_role;

-- Operator-only, SECURITY INVOKER. Never grant to the application role.
-- The caller should SET LOCAL lock_timeout in a short, separately approved
-- transaction. A failed or timed-out UPDATE rolls back the state change.
create function private.transition_public_booking_mode(expected_mode text, next_mode text)
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare updated_mode text;
begin
  if not ((expected_mode = 'legacy' and next_mode = 'frozen')
       or (expected_mode = 'frozen' and next_mode = 'v2')
       or (expected_mode = 'v2' and next_mode = 'v2_no_prepares')) then
    raise exception using errcode = '22023', message = 'booking_contract_invalid_transition';
  end if;
  update private.public_booking_contract_gate as gate
  set mode = next_mode,
      ever_v2 = gate.ever_v2 or next_mode = 'v2',
      changed_at = clock_timestamp()
  where gate.singleton and gate.mode = expected_mode
  returning gate.mode into updated_mode;
  if updated_mode is null then
    raise exception using errcode = '55000', message = 'booking_contract_transition_conflict';
  end if;
  return updated_mode;
end;
$$;
revoke all on function private.transition_public_booking_mode(text,text)
  from public, anon, authenticated, service_role;

-- Preserve the fully validated appointment implementation as a private core.
-- No caller-controlled flag or session setting selects the v2 path.
alter function public.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  set schema private;
alter function private.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  rename to create_public_appointment_core;
revoke all on function private.create_public_appointment_core(text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  from public, anon, authenticated, service_role;

create function public.create_public_appointment(
  target_salon_slug text, target_service_id uuid, target_staff_id uuid,
  requested_start timestamptz, client_full_name text, client_phone text,
  client_email text, client_locale text, request_key uuid
) returns table (
  appointment_id uuid, confirmed_start timestamptz, confirmed_end timestamptz,
  salon_name text, service_title jsonb, currency text, saved_locale text
) language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_public_booking_mode(array['legacy']);
  return query select * from private.create_public_appointment_core(
    target_salon_slug, target_service_id, target_staff_id, requested_start,
    client_full_name, client_phone, client_email, client_locale, request_key);
end;
$$;
revoke all on function public.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  to service_role;

-- Move stateful invoker implementations behind service-role-only definer
-- wrappers. The definer is the migration owner, not service_role; all original
-- tenant, hash, generation, TTL, state, and idempotency checks remain in cores.
alter function public.prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  set schema private;
alter function private.prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  rename to prepare_public_booking_intent_core;
revoke all on function private.prepare_public_booking_intent_core(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  from public, anon, authenticated, service_role;

create function public.prepare_public_booking_intent(
  salon_slug text, browser_token_hash text, service_id uuid, staff_id uuid,
  requested_start timestamptz, client_full_name text, client_phone text,
  client_email text, client_locale text, expected_generation uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_public_booking_mode(array['v2']);
  return private.prepare_public_booking_intent_core(
    salon_slug, browser_token_hash, service_id, staff_id, requested_start,
    client_full_name, client_phone, client_email, client_locale, expected_generation);
end;
$$;
revoke all on function public.prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  to service_role;

-- Commit remains the public entry point but now executes as the migration
-- owner, takes the gate first, and calls the unexposed appointment core.
-- Apart from those two changes, retain the draft intent's exact-state and
-- immutable server-owned request-key semantics.
create or replace function public.commit_public_booking_intent(
  salon_slug text, browser_token_hash text, intent_id uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  selected_tenant_id uuid;
  input_hash text := browser_token_hash;
  current_generation uuid;
  intent private.public_booking_intents%rowtype;
  booked record;
  stored_confirmation jsonb;
begin
  perform private.require_public_booking_mode(array['v2','v2_no_prepares']);
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
    select * into booked from private.create_public_appointment_core(
      salon_slug, intent.service_id, intent.staff_id, intent.requested_start,
      intent.client_full_name, intent.client_phone, intent.client_email,
      intent.client_locale, intent.request_key);
  exception
    when exclusion_violation or invalid_parameter_value or foreign_key_violation then
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

alter function public.reconcile_public_booking_intent(text,text,uuid) set schema private;
alter function private.reconcile_public_booking_intent(text,text,uuid)
  rename to reconcile_public_booking_intent_core;
revoke all on function private.reconcile_public_booking_intent_core(text,text,uuid)
  from public, anon, authenticated, service_role;
create function public.reconcile_public_booking_intent(
  salon_slug text, browser_token_hash text, intent_id uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare current_mode text;
begin
  current_mode := private.require_public_booking_mode(array['v2','v2_no_prepares']);
  -- The old no-ID core bootstraps a session. Do not call it in recovery-only.
  if current_mode = 'v2_no_prepares' and intent_id is null then
    return pg_catalog.jsonb_build_object('state', 'unknown');
  end if;
  return private.reconcile_public_booking_intent_core(salon_slug, browser_token_hash, intent_id);
end;
$$;
revoke all on function public.reconcile_public_booking_intent(text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_public_booking_intent(text,text,uuid)
  to service_role;

alter function public.cancel_public_booking_intent(text,text,uuid) set schema private;
alter function private.cancel_public_booking_intent(text,text,uuid)
  rename to cancel_public_booking_intent_core;
revoke all on function private.cancel_public_booking_intent_core(text,text,uuid)
  from public, anon, authenticated, service_role;
create function public.cancel_public_booking_intent(
  salon_slug text, browser_token_hash text, intent_id uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_public_booking_mode(array['v2','v2_no_prepares']);
  return private.cancel_public_booking_intent_core(salon_slug, browser_token_hash, intent_id);
end;
$$;
revoke all on function public.cancel_public_booking_intent(text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_public_booking_intent(text,text,uuid)
  to service_role;

alter function public.acknowledge_public_booking_intent(text,text,uuid) set schema private;
alter function private.acknowledge_public_booking_intent(text,text,uuid)
  rename to acknowledge_public_booking_intent_core;
revoke all on function private.acknowledge_public_booking_intent_core(text,text,uuid)
  from public, anon, authenticated, service_role;
create function public.acknowledge_public_booking_intent(
  salon_slug text, browser_token_hash text, intent_id uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_public_booking_mode(array['v2','v2_no_prepares']);
  return private.acknowledge_public_booking_intent_core(salon_slug, browser_token_hash, intent_id);
end;
$$;
revoke all on function public.acknowledge_public_booking_intent(text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.acknowledge_public_booking_intent(text,text,uuid)
  to service_role;

-- Cleanup has no session bootstrap path but still needs private DML. Keep it
-- service-role-only, with a fixed search path and its existing bounded logic.
alter function public.sweep_public_booking_intents(integer) security definer;
revoke all on private.public_booking_browser_sessions,
  private.public_booking_intents,
  private.public_booking_intent_cleanup_state
  from service_role;
revoke all on function private.lock_public_booking_browser_session(uuid,text,boolean,boolean),
  private.public_booking_intent_confirmation(uuid,uuid,uuid,timestamptz)
  from service_role;

commit;

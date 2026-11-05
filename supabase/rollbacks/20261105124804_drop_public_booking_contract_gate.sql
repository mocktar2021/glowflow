-- GLOW-56 guarded rollback. Allowed only before v2 has ever opened and while
-- intent, session, policy, quota, and cleanup-heartbeat tables are empty.
-- Never discard a recovery fence or evidence of a prior cleanup run.
-- Run only under a separately approved operator preflight; this does not undo
-- the predecessor intent/quota migrations.
begin;

do $$
declare gate_mode text; opened_v2 boolean;
begin
  select mode, ever_v2 into gate_mode, opened_v2
    from private.public_booking_contract_gate where singleton for update;
  if not found or gate_mode <> 'legacy' or opened_v2 then
    raise exception using errcode = '55000', message = 'booking_contract_rollback_requires_never_opened_legacy';
  end if;
  if exists (select 1 from private.public_booking_intents)
     or exists (select 1 from private.public_booking_browser_sessions)
     or exists (select 1 from private.public_booking_intent_policy)
     or exists (select 1 from private.public_booking_intent_cleanup_state)
     or exists (select 1 from private.public_booking_quota_policy)
     or exists (select 1 from private.public_booking_quota_counters)
     or exists (select 1 from private.public_booking_quota_cleanup_state) then
    raise exception using errcode = '55000', message = 'booking_contract_rollback_rows_present';
  end if;
end;
$$;

-- Restore the original service-role-only v1 appointment implementation.
drop function public.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid);
alter function private.create_public_appointment_core(text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  rename to create_public_appointment;
alter function private.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  set schema public;
grant execute on function public.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  to service_role;

-- Restore the pre-gate commit body and invoker identity after the v1 RPC is back.
create or replace function public.commit_public_booking_intent(
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

-- Restore the remaining original invoker RPCs without changing their bodies.
drop function public.prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid);
alter function private.prepare_public_booking_intent_core(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  rename to prepare_public_booking_intent;
alter function private.prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  set schema public;
grant execute on function public.prepare_public_booking_intent(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)
  to service_role;

drop function public.reconcile_public_booking_intent(text,text,uuid);
alter function private.reconcile_public_booking_intent_core(text,text,uuid)
  rename to reconcile_public_booking_intent;
alter function private.reconcile_public_booking_intent(text,text,uuid)
  set schema public;
grant execute on function public.reconcile_public_booking_intent(text,text,uuid)
  to service_role;

drop function public.cancel_public_booking_intent(text,text,uuid);
alter function private.cancel_public_booking_intent_core(text,text,uuid)
  rename to cancel_public_booking_intent;
alter function private.cancel_public_booking_intent(text,text,uuid)
  set schema public;
grant execute on function public.cancel_public_booking_intent(text,text,uuid)
  to service_role;

drop function public.acknowledge_public_booking_intent(text,text,uuid);
alter function private.acknowledge_public_booking_intent_core(text,text,uuid)
  rename to acknowledge_public_booking_intent;
alter function private.acknowledge_public_booking_intent(text,text,uuid)
  set schema public;
grant execute on function public.acknowledge_public_booking_intent(text,text,uuid)
  to service_role;

alter function public.sweep_public_booking_intents(integer) security invoker;
grant select, insert, update, delete on private.public_booking_browser_sessions,
  private.public_booking_intents to service_role;
grant select, insert, update on private.public_booking_intent_cleanup_state to service_role;
grant execute on function private.lock_public_booking_browser_session(uuid,text,boolean,boolean),
  private.public_booking_intent_confirmation(uuid,uuid,uuid,timestamptz)
  to service_role;

drop function private.require_public_booking_mode(text[]);
drop function private.transition_public_booking_mode(text,text);
drop table private.public_booking_contract_gate;

commit;

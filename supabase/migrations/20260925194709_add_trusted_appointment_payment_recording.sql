-- GLOW-33: trusted appointment totals and bounded manual payment recording.
-- Snapshot catalog values once so later service edits cannot rewrite payment history.

begin;

alter table public.appointments
  add column service_title_json jsonb,
  add column service_price integer,
  add column service_deposit_amount integer,
  add column service_currency text;

update public.appointments as appointment
set
  service_title_json = service.title_json,
  service_price = service.price,
  service_deposit_amount = service.deposit_amount,
  service_currency = service.currency
from public.services as service
where service.id = appointment.service_id
  and service.tenant_id = appointment.tenant_id;

alter table public.appointments
  alter column service_title_json set not null,
  alter column service_price set not null,
  alter column service_deposit_amount set not null,
  alter column service_currency set not null,
  add constraint appointments_service_title_object_check
    check (jsonb_typeof(service_title_json) = 'object' and service_title_json ? 'fr'),
  add constraint appointments_service_price_check
    check (service_price >= 0),
  add constraint appointments_service_deposit_check
    check (service_deposit_amount between 0 and service_price),
  add constraint appointments_service_currency_check
    check (service_currency ~ '^[A-Z]{3}$');

create or replace function private.set_appointment_service_timing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_service public.services%rowtype;
begin
  if tg_op = 'INSERT' then
    select service.* into selected_service
    from public.services as service
    where service.id = new.service_id
      and service.tenant_id = new.tenant_id;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'appointment_service_not_found';
    end if;

    new.service_duration_minutes := selected_service.duration_minutes;
    new.sanitation_buffer_minutes := selected_service.sanitation_buffer_minutes;
    new.station_name := nullif(btrim(selected_service.station_name), '');
    new.service_title_json := selected_service.title_json;
    new.service_price := selected_service.price;
    new.service_deposit_amount := selected_service.deposit_amount;
    new.service_currency := selected_service.currency;
  else
    new.tenant_id := old.tenant_id;
    new.service_id := old.service_id;
    new.service_duration_minutes := old.service_duration_minutes;
    new.sanitation_buffer_minutes := old.sanitation_buffer_minutes;
    new.station_name := old.station_name;
    new.service_title_json := old.service_title_json;
    new.service_price := old.service_price;
    new.service_deposit_amount := old.service_deposit_amount;
    new.service_currency := old.service_currency;
  end if;

  if tg_op = 'INSERT' or new.start_time is distinct from old.start_time then
    new.end_time := new.start_time + make_interval(mins => new.service_duration_minutes);
    new.buffer_end_time := new.end_time + make_interval(mins => new.sanitation_buffer_minutes);
  else
    new.end_time := old.end_time;
    new.buffer_end_time := old.buffer_end_time;
  end if;

  return new;
end;
$$;

create or replace function private.validate_payment_entry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  appointment_currency text;
  appointment_total integer;
  tenant_provider_account text;
  paid_total bigint;
  refunded_total bigint;
  net_paid_total bigint;
begin
  if (select auth.uid()) is not null then
    if not (select private.is_tenant_owner(new.tenant_id)) then
      raise exception using errcode = '42501', message = 'payment_owner_required';
    end if;
  end if;

  -- The row lock makes the outstanding-balance and refund limits concurrency-safe.
  select appointment.service_currency, appointment.service_price
  into appointment_currency, appointment_total
  from public.appointments as appointment
  where appointment.id = new.appointment_id
    and appointment.tenant_id = new.tenant_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'payment_appointment_not_found';
  end if;

  if new.currency is distinct from appointment_currency then
    raise exception using errcode = '22023', message = 'payment_currency_mismatch';
  end if;

  if new.payment_method = 'stripe' then
    select stripe_account_id into tenant_provider_account
    from public.tenants
    where id = new.tenant_id;

    if tenant_provider_account is null
       or new.provider_account_id is distinct from tenant_provider_account then
      raise exception using errcode = '22023', message = 'payment_provider_account_mismatch';
    end if;
  end if;

  select
    coalesce(sum(amount) filter (where entry_type = 'payment'), 0),
    coalesce(sum(amount) filter (where entry_type = 'refund'), 0)
  into paid_total, refunded_total
  from public.payment_entries
  where appointment_id = new.appointment_id
    and tenant_id = new.tenant_id;

  net_paid_total := paid_total - refunded_total;

  if new.entry_type = 'payment'
     and new.amount > appointment_total - net_paid_total then
    raise exception using errcode = '22023', message = 'payment_exceeds_outstanding_balance';
  end if;

  if new.entry_type = 'refund'
     and refunded_total + new.amount > paid_total then
    raise exception using errcode = '22023', message = 'refund_exceeds_paid_amount';
  end if;

  return new;
end;
$$;

create or replace function public.record_manual_appointment_payment(
  target_appointment_id uuid,
  target_payment_method text,
  target_amount integer,
  request_key uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_tenant_id uuid;
  appointment_currency text;
  existing_entry public.payment_entries%rowtype;
  new_entry_id uuid;
begin
  select membership.tenant_id into target_tenant_id
  from public.users as membership
  where membership.id = current_user_id
    and membership.role = 'owner';

  if target_tenant_id is null then
    raise exception using errcode = '42501', message = 'payment_owner_required';
  end if;

  if target_payment_method is null
     or target_payment_method not in ('cash', 'external_card')
     or target_amount is null or target_amount <= 0
     or request_key is null then
    raise exception using errcode = '22023', message = 'invalid_manual_payment';
  end if;

  select entry.* into existing_entry
  from public.payment_entries as entry
  where entry.tenant_id = target_tenant_id
    and entry.idempotency_key = request_key;

  if found then
    if existing_entry.appointment_id is distinct from target_appointment_id
       or existing_entry.entry_type <> 'payment'
       or existing_entry.payment_method <> target_payment_method
       or existing_entry.amount <> target_amount then
      raise exception using errcode = '22023', message = 'payment_idempotency_key_reuse';
    end if;
    return existing_entry.id;
  end if;

  select appointment.service_currency into appointment_currency
  from public.appointments as appointment
  where appointment.id = target_appointment_id
    and appointment.tenant_id = target_tenant_id;

  if appointment_currency is null then
    raise exception using errcode = '23503', message = 'payment_appointment_not_found';
  end if;

  begin
    insert into public.payment_entries (
      tenant_id, appointment_id, entry_type, payment_method,
      amount, currency, idempotency_key, actor_user_id
    ) values (
      target_tenant_id, target_appointment_id, 'payment', target_payment_method,
      target_amount, appointment_currency, request_key, current_user_id
    )
    returning id into new_entry_id;
  exception when unique_violation then
    -- A concurrent retry may observe the unique key only after the first commit.
    select entry.* into existing_entry
    from public.payment_entries as entry
    where entry.tenant_id = target_tenant_id
      and entry.idempotency_key = request_key;

    if not found
       or existing_entry.appointment_id is distinct from target_appointment_id
       or existing_entry.entry_type <> 'payment'
       or existing_entry.payment_method <> target_payment_method
       or existing_entry.amount <> target_amount then
      raise exception using errcode = '22023', message = 'payment_idempotency_key_reuse';
    end if;
    return existing_entry.id;
  end;

  return new_entry_id;
end;
$$;

revoke all on function public.record_manual_appointment_payment(uuid, text, integer, uuid)
from public, anon;
grant execute on function public.record_manual_appointment_payment(uuid, text, integer, uuid)
to authenticated;

comment on function public.record_manual_appointment_payment(uuid, text, integer, uuid) is
  'Owner-only idempotent recording of cash or externally processed card tender, bounded by the immutable appointment total.';

commit;

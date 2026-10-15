-- GLOW-22: appointment creation accepts only a slot exposed by public availability.
-- The resource check after the advisory lock remains the final concurrency guard.

begin;

create or replace function public.create_public_appointment(
  target_salon_slug text,
  target_service_id uuid,
  target_staff_id uuid,
  requested_start timestamptz,
  client_full_name text,
  client_phone text,
  client_email text,
  client_locale text,
  request_key uuid
)
returns table (
  appointment_id uuid,
  confirmed_start timestamptz,
  confirmed_end timestamptz,
  salon_name text,
  service_title jsonb,
  currency text,
  saved_locale text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_tenant_id uuid;
  selected_time_zone text;
  selected_station text;
  selected_duration integer;
  selected_buffer integer;
  selected_service_title jsonb;
  selected_currency text;
  selected_salon_name text;
  new_client_id uuid;
  new_appointment_id uuid;
  existing_appointment public.appointments%rowtype;
begin
  if char_length(btrim(client_full_name)) not between 2 and 120
     or client_locale not in ('fr', 'en', 'es')
     or (nullif(btrim(client_phone), '') is null and nullif(btrim(client_email), '') is null)
     or (nullif(btrim(client_email), '') is not null and btrim(client_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
     or requested_start <= now()
     or requested_start > now() + interval '90 days' then
    raise exception using errcode = '22023', message = 'invalid_public_booking';
  end if;

  select tenant.id, tenant.name, tenant.time_zone, tenant.currency,
         nullif(btrim(service.station_name), ''), service.duration_minutes,
         service.sanitation_buffer_minutes, service.title_json
  into selected_tenant_id, selected_salon_name, selected_time_zone, selected_currency,
       selected_station, selected_duration, selected_buffer, selected_service_title
  from public.tenants as tenant
  join public.services as service on service.tenant_id = tenant.id
  join public.markets as market on market.country_code = tenant.country_code
  where tenant.slug = btrim(target_salon_slug)
    and tenant.is_booking_enabled
    and market.status = 'active'
    and exists (
      select 1
      from public.salon_public_profiles as profile
      where profile.tenant_id = tenant.id
        and profile.is_published = true
    )
    and service.id = target_service_id
    and service.is_active;

  if selected_tenant_id is null then
    raise exception using errcode = '23503', message = 'public_service_not_found';
  end if;

  -- Idempotent retries must return the stored result even though that appointment
  -- now makes its original slot unavailable.
  select appointment.* into existing_appointment
  from public.appointments as appointment
  where appointment.tenant_id = selected_tenant_id
    and appointment.public_booking_request_key = request_key;

  if found then
    return query select existing_appointment.id, existing_appointment.start_time,
      existing_appointment.end_time, selected_salon_name, selected_service_title,
      selected_currency, existing_appointment.booking_locale;
    return;
  end if;

  -- Serialize the request key independently of the requested start. A concurrent
  -- retry may drift to another start but must still converge on the first result.
  if request_key is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        selected_tenant_id::text || ':public-booking-request:' || request_key::text,
        0
      )
    );

    -- This is the authoritative idempotency read. A competing transaction may
    -- have committed while this transaction waited for the request-key lock.
    select appointment.* into existing_appointment
    from public.appointments as appointment
    where appointment.tenant_id = selected_tenant_id
      and appointment.public_booking_request_key = request_key;

    if found then
      return query select existing_appointment.id, existing_appointment.start_time,
        existing_appointment.end_time, selected_salon_name, selected_service_title,
        selected_currency, existing_appointment.booking_locale;
      return;
    end if;
  end if;

  if not exists (
    select 1 from public.users
    where id = target_staff_id and tenant_id = selected_tenant_id
  ) then
    raise exception using errcode = '23503', message = 'public_staff_not_found';
  end if;

  if exists (
    select 1
    from public.service_staff as configured_staff
    where configured_staff.tenant_id = selected_tenant_id
      and configured_staff.service_id = target_service_id
  ) and not exists (
    select 1
    from public.service_staff as eligible_staff
    where eligible_staff.tenant_id = selected_tenant_id
      and eligible_staff.service_id = target_service_id
      and eligible_staff.staff_id = target_staff_id
  ) then
    raise exception using errcode = '23503', message = 'public_staff_not_eligible';
  end if;

  -- A client may submit only a start that the availability RPC exposes for the
  -- same service, staff member, and tenant-local date. This rejects forged
  -- off-grid starts and times outside staff or station working hours.
  if not exists (
    select 1
    from public.get_public_booking_slots(
      target_salon_slug,
      target_service_id,
      (requested_start at time zone selected_time_zone)::date
    ) as available_slot
    where available_slot.staff_id = target_staff_id
      and available_slot.slot_start = requested_start
  ) then
    raise exception using errcode = '23P01', message = 'public_time_unavailable';
  end if;

  -- Keep a distinct resource lock so different request keys competing for the
  -- same start are serialized before the final conflict check.
  perform pg_advisory_xact_lock(
    hashtextextended(selected_tenant_id::text || requested_start::text, 0)
  );

  -- Recheck after the lock so a slot consumed between listing and confirmation
  -- cannot be double-booked.
  if not private.public_resource_available(
    selected_tenant_id,
    target_staff_id,
    selected_station,
    requested_start,
    requested_start + make_interval(mins => selected_duration + selected_buffer)
  ) then
    raise exception using errcode = '23P01', message = 'public_time_unavailable';
  end if;

  insert into public.clients (tenant_id, full_name, phone, email, preferred_locale)
  values (
    selected_tenant_id,
    btrim(client_full_name),
    nullif(btrim(client_phone), ''),
    nullif(lower(btrim(client_email)), ''),
    client_locale
  )
  returning id into new_client_id;

  insert into public.appointments (
    tenant_id, client_id, service_id, staff_id, start_time, end_time,
    status, deposit_paid, public_booking_request_key, booking_locale
  )
  values (
    selected_tenant_id, new_client_id, target_service_id, target_staff_id,
    requested_start, requested_start + make_interval(mins => selected_duration),
    'confirmed', false, request_key, client_locale
  )
  returning id into new_appointment_id;

  return query select new_appointment_id, requested_start,
    requested_start + make_interval(mins => selected_duration),
    selected_salon_name, selected_service_title, selected_currency, client_locale;
end;
$$;

revoke all on function public.create_public_appointment(text, uuid, uuid, timestamptz, text, text, text, text, uuid)
from public, anon, authenticated;
grant execute on function public.create_public_appointment(text, uuid, uuid, timestamptz, text, text, text, text, uuid)
to service_role;

commit;

-- GLOW-22: public availability and booking honor optional service staff assignments.
-- A service without assignments remains available to the whole tenant team.

begin;

create or replace function public.get_public_booking_slots(
  target_salon_slug text,
  target_service_id uuid,
  target_local_date date
)
returns table (slot_start timestamptz, staff_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_tenant_id uuid;
  selected_time_zone text;
  selected_station text;
  selected_duration integer;
  selected_buffer integer;
begin
  if target_local_date < current_date or target_local_date > current_date + 90 then
    return;
  end if;

  select tenant.id, tenant.time_zone, nullif(btrim(service.station_name), ''),
         service.duration_minutes, service.sanitation_buffer_minutes
  into selected_tenant_id, selected_time_zone, selected_station,
       selected_duration, selected_buffer
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

  if selected_tenant_id is null then return; end if;

  return query
  select candidate.slot_start, candidate.staff_id
  from (
    select
      generated.local_start at time zone selected_time_zone as slot_start,
      hours.staff_id
    from public.staff_working_hours as hours
    cross join lateral generate_series(
      target_local_date + hours.start_local,
      target_local_date + hours.end_local
        - make_interval(mins => selected_duration + selected_buffer),
      interval '30 minutes'
    ) as generated(local_start)
    where hours.tenant_id = selected_tenant_id
      and hours.weekday = extract(dow from target_local_date)::smallint
      and hours.is_enabled
      and (
        not exists (
          select 1
          from public.service_staff as configured_staff
          where configured_staff.tenant_id = selected_tenant_id
            and configured_staff.service_id = target_service_id
        )
        or exists (
          select 1
          from public.service_staff as eligible_staff
          where eligible_staff.tenant_id = selected_tenant_id
            and eligible_staff.service_id = target_service_id
            and eligible_staff.staff_id = hours.staff_id
        )
      )
  ) as candidate
  where candidate.slot_start > now()
    and private.public_resource_available(
      selected_tenant_id,
      candidate.staff_id,
      selected_station,
      candidate.slot_start,
      candidate.slot_start + make_interval(mins => selected_duration + selected_buffer)
    )
  order by candidate.slot_start, candidate.staff_id;
end;
$$;

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

  perform pg_advisory_xact_lock(
    hashtextextended(selected_tenant_id::text || requested_start::text, 0)
  );

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


revoke all on function public.get_public_booking_slots(text, uuid, date)
from public, anon, authenticated;
revoke all on function public.create_public_appointment(text, uuid, uuid, timestamptz, text, text, text, text, uuid)
from public, anon, authenticated;

grant execute on function public.get_public_booking_slots(text, uuid, date)
to service_role;
grant execute on function public.create_public_appointment(text, uuid, uuid, timestamptz, text, text, text, text, uuid)
to service_role;

commit;

-- GLOW-20: idempotent calendar appointment creation and salon-time rescheduling.

alter table public.appointments
  add column if not exists calendar_request_key uuid;

create unique index if not exists appointments_calendar_request_key_idx
  on public.appointments (tenant_id, calendar_request_key)
  where calendar_request_key is not null;

create or replace function public.create_calendar_appointment(
  target_client_id uuid,
  target_service_id uuid,
  target_staff_id uuid,
  local_start timestamp without time zone,
  request_key uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_tenant_id uuid;
  target_time_zone text;
  target_station text;
  requested_start timestamptz;
  requested_end timestamptz;
  duration_minutes integer;
  existing_id uuid;
  new_id uuid;
begin
  select membership.tenant_id, tenant.time_zone
  into target_tenant_id, target_time_zone
  from public.users as membership
  join public.tenants as tenant on tenant.id = membership.tenant_id
  where membership.id = (select auth.uid());

  if target_tenant_id is null then
    raise exception using errcode = '42501', message = 'membership_required';
  end if;

  select appointment.id into existing_id
  from public.appointments as appointment
  where appointment.tenant_id = target_tenant_id
    and appointment.calendar_request_key = request_key;

  if existing_id is not null then return existing_id; end if;

  select service.duration_minutes, nullif(btrim(service.station_name), '')
  into duration_minutes, target_station
  from public.services as service
  where service.id = target_service_id
    and service.tenant_id = target_tenant_id
    and service.is_active = true;

  if duration_minutes is null then
    raise exception using errcode = '23503', message = 'service_not_found';
  end if;

  if not exists (select 1 from public.clients where id = target_client_id and tenant_id = target_tenant_id)
     or not exists (select 1 from public.users where id = target_staff_id and tenant_id = target_tenant_id) then
    raise exception using errcode = '23503', message = 'calendar_resource_not_found';
  end if;

  requested_start := local_start at time zone target_time_zone;
  requested_end := requested_start + make_interval(mins => duration_minutes);

  if not public.is_resource_available(
    target_tenant_id, target_staff_id, target_station, requested_start, requested_end
  ) then
    raise exception using errcode = '23P01', message = 'calendar_time_unavailable';
  end if;

  insert into public.appointments (
    tenant_id, client_id, service_id, staff_id, start_time, end_time,
    status, deposit_paid, calendar_request_key
  )
  values (
    target_tenant_id, target_client_id, target_service_id, target_staff_id,
    requested_start, requested_end, 'confirmed', false, request_key
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.create_calendar_appointment(uuid, uuid, uuid, timestamp without time zone, uuid)
from public, anon;
grant execute on function public.create_calendar_appointment(uuid, uuid, uuid, timestamp without time zone, uuid)
to authenticated;

create or replace function public.reschedule_calendar_appointment(
  target_appointment_id uuid,
  local_start timestamp without time zone
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_tenant_id uuid;
  target_time_zone text;
  previous_status text;
  requested_start timestamptz;
  requested_end timestamptz;
  target_staff_id uuid;
  target_station text;
  target_duration integer;
begin
  select membership.tenant_id, tenant.time_zone
  into target_tenant_id, target_time_zone
  from public.users as membership
  join public.tenants as tenant on tenant.id = membership.tenant_id
  where membership.id = (select auth.uid());

  if target_tenant_id is null then
    raise exception using errcode = '42501', message = 'membership_required';
  end if;

  update public.appointments
  set status = 'canceled'
  where id = target_appointment_id
    and tenant_id = target_tenant_id
    and status = 'confirmed'
  returning status, staff_id, station_name, service_duration_minutes
  into previous_status, target_staff_id, target_station, target_duration;

  if previous_status is null then
    raise exception using errcode = '22023', message = 'appointment_not_reschedulable';
  end if;

  requested_start := local_start at time zone target_time_zone;
  requested_end := requested_start + make_interval(mins => target_duration);

  if not public.is_resource_available(
    target_tenant_id, target_staff_id, target_station, requested_start, requested_end
  ) then
    raise exception using errcode = '23P01', message = 'calendar_time_unavailable';
  end if;

  update public.appointments
  set start_time = requested_start, status = 'confirmed'
  where id = target_appointment_id
    and tenant_id = target_tenant_id;
end;
$$;

revoke all on function public.reschedule_calendar_appointment(uuid, timestamp without time zone)
from public, anon;
grant execute on function public.reschedule_calendar_appointment(uuid, timestamp without time zone)
to authenticated;

create or replace function public.cancel_calendar_appointment(target_appointment_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_id uuid;
begin
  update public.appointments
  set status = 'canceled'
  where id = target_appointment_id
    and status = 'confirmed'
    and (select private.is_tenant_member(tenant_id))
  returning id into changed_id;

  if changed_id is null then
    raise exception using errcode = '22023', message = 'appointment_not_cancelable';
  end if;
end;
$$;

revoke all on function public.cancel_calendar_appointment(uuid) from public, anon;
grant execute on function public.cancel_calendar_appointment(uuid) to authenticated;

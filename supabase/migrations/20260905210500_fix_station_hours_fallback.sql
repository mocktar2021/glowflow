-- GLOW-20: allow staff schedules to govern stations without configured hours.

create or replace function public.is_resource_available(
  target_tenant_id uuid,
  target_staff_id uuid,
  target_station text,
  requested_start timestamptz,
  requested_end timestamptz
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  target_time_zone text;
  local_start timestamp without time zone;
  local_end timestamp without time zone;
  local_weekday smallint;
begin
  if requested_end <= requested_start
     or not (select private.is_tenant_member(target_tenant_id)) then
    return false;
  end if;

  select time_zone into target_time_zone
  from public.tenants where id = target_tenant_id;

  if target_time_zone is null then return false; end if;

  local_start := requested_start at time zone target_time_zone;
  local_end := requested_end at time zone target_time_zone;
  local_weekday := extract(dow from local_start)::smallint;

  if local_start::date <> local_end::date then return false; end if;

  if not exists (
    select 1
    from public.staff_working_hours as hours
    where hours.tenant_id = target_tenant_id
      and hours.staff_id = target_staff_id
      and hours.weekday = local_weekday
      and hours.is_enabled = true
      and hours.start_local <= local_start::time
      and hours.end_local >= local_end::time
  ) then return false; end if;

  if exists (
    select 1
    from public.staff_schedule_exceptions as exception
    where exception.tenant_id = target_tenant_id
      and exception.staff_id = target_staff_id
      and tstzrange(exception.starts_at, exception.ends_at, '[)')
          && tstzrange(requested_start, requested_end, '[)')
  ) then return false; end if;

  if nullif(btrim(target_station), '') is not null
     and exists (
       select 1
       from public.station_working_hours as configured_hours
       where configured_hours.tenant_id = target_tenant_id
         and configured_hours.station_name = btrim(target_station)
     )
     and not exists (
       select 1
       from public.station_working_hours as hours
       where hours.tenant_id = target_tenant_id
         and hours.station_name = btrim(target_station)
         and hours.weekday = local_weekday
         and hours.is_enabled = true
         and hours.start_local <= local_start::time
         and hours.end_local >= local_end::time
     ) then return false;
  end if;

  if exists (
    select 1
    from public.appointments as appointment
    where appointment.tenant_id = target_tenant_id
      and appointment.status = 'confirmed'
      and (
        appointment.staff_id = target_staff_id
        or (
          nullif(btrim(target_station), '') is not null
          and appointment.station_name = btrim(target_station)
        )
      )
      and tstzrange(appointment.start_time, appointment.buffer_end_time, '[)')
          && tstzrange(requested_start, requested_end, '[)')
  ) then return false; end if;

  return true;
end;
$$;

revoke all on function public.is_resource_available(uuid, uuid, text, timestamptz, timestamptz)
from public, anon;
grant execute on function public.is_resource_available(uuid, uuid, text, timestamptz, timestamptz)
to authenticated;

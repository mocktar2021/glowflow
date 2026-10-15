-- GLOW-18: authoritative appointment duration, sanitation buffers, and overlap protection.
-- Concurrent inserts are serialized by PostgreSQL exclusion constraints.

create extension if not exists btree_gist;

alter table public.appointments
  add column if not exists service_duration_minutes integer,
  add column if not exists sanitation_buffer_minutes integer,
  add column if not exists station_name text,
  add column if not exists buffer_end_time timestamptz;

update public.appointments as appointment
set
  service_duration_minutes = service.duration_minutes,
  sanitation_buffer_minutes = service.sanitation_buffer_minutes,
  station_name = nullif(btrim(service.station_name), ''),
  end_time = appointment.start_time + make_interval(mins => service.duration_minutes),
  buffer_end_time = appointment.start_time
    + make_interval(mins => service.duration_minutes + service.sanitation_buffer_minutes)
from public.services as service
where service.id = appointment.service_id
  and service.tenant_id = appointment.tenant_id
  and (
    appointment.service_duration_minutes is null
    or appointment.sanitation_buffer_minutes is null
    or appointment.buffer_end_time is null
  );

alter table public.appointments
  alter column service_duration_minutes set not null,
  alter column sanitation_buffer_minutes set not null,
  alter column buffer_end_time set not null;

alter table public.appointments
  add constraint appointments_service_duration_check
    check (service_duration_minutes between 5 and 720),
  add constraint appointments_sanitation_buffer_check
    check (sanitation_buffer_minutes between 0 and 120),
  add constraint appointments_buffer_end_check
    check (buffer_end_time >= end_time);

create or replace function private.set_appointment_service_timing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_duration integer;
  selected_buffer integer;
  selected_station text;
begin
  if tg_op = 'INSERT'
     or new.tenant_id is distinct from old.tenant_id
     or new.service_id is distinct from old.service_id
     or new.start_time is distinct from old.start_time then
    select
      service.duration_minutes,
      service.sanitation_buffer_minutes,
      nullif(btrim(service.station_name), '')
    into selected_duration, selected_buffer, selected_station
    from public.services as service
    where service.id = new.service_id
      and service.tenant_id = new.tenant_id;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'appointment_service_not_found';
    end if;

    new.service_duration_minutes := selected_duration;
    new.sanitation_buffer_minutes := selected_buffer;
    new.station_name := selected_station;
    new.end_time := new.start_time + make_interval(mins => selected_duration);
    new.buffer_end_time := new.end_time + make_interval(mins => selected_buffer);
  else
    new.service_duration_minutes := old.service_duration_minutes;
    new.sanitation_buffer_minutes := old.sanitation_buffer_minutes;
    new.station_name := old.station_name;
    new.end_time := old.end_time;
    new.buffer_end_time := old.buffer_end_time;
  end if;

  return new;
end;
$$;

revoke all on function private.set_appointment_service_timing() from public, anon, authenticated;

drop trigger if exists appointments_set_service_timing on public.appointments;
create trigger appointments_set_service_timing
before insert or update on public.appointments
for each row execute function private.set_appointment_service_timing();

alter table public.appointments
  drop constraint if exists appointments_staff_no_overlap,
  drop constraint if exists appointments_station_no_overlap;

alter table public.appointments
  add constraint appointments_staff_no_overlap
  exclude using gist (
    tenant_id with =,
    staff_id with =,
    tstzrange(start_time, buffer_end_time, '[)') with &&
  )
  where (status = 'confirmed');

alter table public.appointments
  add constraint appointments_station_no_overlap
  exclude using gist (
    tenant_id with =,
    station_name with =,
    tstzrange(start_time, buffer_end_time, '[)') with &&
  )
  where (status = 'confirmed' and station_name is not null);

create index if not exists appointments_tenant_station_start_idx
  on public.appointments (tenant_id, station_name, start_time)
  where status = 'confirmed' and station_name is not null;

comment on constraint appointments_staff_no_overlap on public.appointments is
  'Prevents confirmed staff bookings from overlapping service and sanitation time.';

comment on constraint appointments_station_no_overlap on public.appointments is
  'Prevents confirmed station bookings from overlapping service and sanitation time.';

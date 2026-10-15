-- GLOW-19: owner-managed staff schedules, breaks, time off, and station hours.

create table public.staff_working_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_local time not null default '09:00',
  end_local time not null default '17:00',
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, staff_id, weekday),
  foreign key (staff_id, tenant_id)
    references public.users(id, tenant_id) on delete cascade,
  check (end_local > start_local)
);

create table public.staff_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null,
  kind text not null check (kind in ('break', 'time_off')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text check (note is null or char_length(note) <= 240),
  created_at timestamptz not null default now(),
  foreign key (staff_id, tenant_id)
    references public.users(id, tenant_id) on delete cascade,
  check (ends_at > starts_at)
);

create table public.station_working_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  station_name text not null check (char_length(btrim(station_name)) between 1 and 120),
  weekday smallint not null check (weekday between 0 and 6),
  start_local time not null default '09:00',
  end_local time not null default '17:00',
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, station_name, weekday),
  check (end_local > start_local)
);

create index staff_schedule_exceptions_lookup_idx
  on public.staff_schedule_exceptions (tenant_id, staff_id, starts_at, ends_at);

create index station_working_hours_lookup_idx
  on public.station_working_hours (tenant_id, station_name, weekday)
  where is_enabled = true;

alter table public.staff_working_hours enable row level security;
alter table public.staff_schedule_exceptions enable row level security;
alter table public.station_working_hours enable row level security;

create policy staff_working_hours_tenant_select
on public.staff_working_hours for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy staff_working_hours_owner_insert
on public.staff_working_hours for insert to authenticated
with check ((select private.is_tenant_owner(tenant_id)));

create policy staff_working_hours_owner_update
on public.staff_working_hours for update to authenticated
using ((select private.is_tenant_owner(tenant_id)))
with check ((select private.is_tenant_owner(tenant_id)));

create policy staff_working_hours_owner_delete
on public.staff_working_hours for delete to authenticated
using ((select private.is_tenant_owner(tenant_id)));

create policy staff_schedule_exceptions_tenant_select
on public.staff_schedule_exceptions for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy staff_schedule_exceptions_owner_insert
on public.staff_schedule_exceptions for insert to authenticated
with check ((select private.is_tenant_owner(tenant_id)));

create policy staff_schedule_exceptions_owner_update
on public.staff_schedule_exceptions for update to authenticated
using ((select private.is_tenant_owner(tenant_id)))
with check ((select private.is_tenant_owner(tenant_id)));

create policy staff_schedule_exceptions_owner_delete
on public.staff_schedule_exceptions for delete to authenticated
using ((select private.is_tenant_owner(tenant_id)));

create policy station_working_hours_tenant_select
on public.station_working_hours for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy station_working_hours_owner_insert
on public.station_working_hours for insert to authenticated
with check ((select private.is_tenant_owner(tenant_id)));

create policy station_working_hours_owner_update
on public.station_working_hours for update to authenticated
using ((select private.is_tenant_owner(tenant_id)))
with check ((select private.is_tenant_owner(tenant_id)));

create policy station_working_hours_owner_delete
on public.station_working_hours for delete to authenticated
using ((select private.is_tenant_owner(tenant_id)));

revoke all on public.staff_working_hours, public.staff_schedule_exceptions, public.station_working_hours
from anon, authenticated;

grant select, insert, update, delete
on public.staff_working_hours, public.staff_schedule_exceptions, public.station_working_hours
to authenticated;

create or replace function public.create_staff_schedule_exception(
  target_staff_id uuid,
  exception_kind text,
  local_start timestamp without time zone,
  local_end timestamp without time zone,
  note_text text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_tenant_id uuid;
  target_time_zone text;
  new_id uuid;
begin
  select membership.tenant_id, tenant.time_zone
  into target_tenant_id, target_time_zone
  from public.users as membership
  join public.tenants as tenant on tenant.id = membership.tenant_id
  where membership.id = (select auth.uid())
    and membership.role = 'owner';

  if target_tenant_id is null then
    raise exception using errcode = '42501', message = 'owner_required';
  end if;

  if exception_kind not in ('break', 'time_off') or local_end <= local_start then
    raise exception using errcode = '22023', message = 'invalid_schedule_exception';
  end if;

  if not exists (
    select 1 from public.users
    where id = target_staff_id and tenant_id = target_tenant_id
  ) then
    raise exception using errcode = '23503', message = 'staff_not_found';
  end if;

  insert into public.staff_schedule_exceptions (
    tenant_id, staff_id, kind, starts_at, ends_at, note
  )
  values (
    target_tenant_id,
    target_staff_id,
    exception_kind,
    local_start at time zone target_time_zone,
    local_end at time zone target_time_zone,
    nullif(btrim(note_text), '')
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.create_staff_schedule_exception(uuid, text, timestamp without time zone, timestamp without time zone, text)
from public, anon;
grant execute on function public.create_staff_schedule_exception(uuid, text, timestamp without time zone, timestamp without time zone, text)
to authenticated;

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

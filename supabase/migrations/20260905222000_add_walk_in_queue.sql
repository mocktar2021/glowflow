-- GLOW-21: tenant-scoped real-time walk-in queue.

create table public.walk_in_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_name text not null check (char_length(btrim(client_name)) between 2 and 120),
  service_id uuid not null references public.services(id),
  staff_id uuid references public.users(id),
  station_name text,
  status text not null default 'waiting'
    check (status in ('waiting', 'ready', 'in_service', 'completed', 'removed')),
  position integer not null check (position > 0),
  estimated_wait_minutes integer not null default 0
    check (estimated_wait_minutes between 0 and 720),
  arrived_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references public.users(id),
  updated_at timestamptz not null default now()
);

create index walk_in_queue_active_order_idx
  on public.walk_in_queue (tenant_id, position)
  where status in ('waiting', 'ready', 'in_service');

create index walk_in_queue_reporting_idx
  on public.walk_in_queue (tenant_id, arrived_at desc);

alter table public.walk_in_queue enable row level security;

grant select, insert, update, delete on public.walk_in_queue to authenticated;
revoke all on public.walk_in_queue from anon;

create policy "tenant members view walk ins"
on public.walk_in_queue for select
to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy "tenant members create walk ins"
on public.walk_in_queue for insert
to authenticated
with check (
  (select private.is_tenant_member(tenant_id))
  and created_by = (select auth.uid())
);

create policy "tenant members update walk ins"
on public.walk_in_queue for update
to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

create policy "tenant members delete walk ins"
on public.walk_in_queue for delete
to authenticated
using ((select private.is_tenant_member(tenant_id)));

create or replace function public.enqueue_walk_in(
  target_client_name text,
  target_service_id uuid,
  target_staff_id uuid default null,
  target_station_name text default null,
  target_estimated_wait_minutes integer default 0
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_tenant_id uuid;
  next_position integer;
  new_id uuid;
begin
  select membership.tenant_id into target_tenant_id
  from public.users as membership
  where membership.id = (select auth.uid())
    and membership.role in ('owner', 'staff');

  if target_tenant_id is null then
    raise exception using errcode = '42501', message = 'membership_required';
  end if;

  if char_length(btrim(target_client_name)) not between 2 and 120
     or target_estimated_wait_minutes not between 0 and 720 then
    raise exception using errcode = '22023', message = 'invalid_walk_in';
  end if;

  if not exists (
    select 1 from public.services
    where id = target_service_id and tenant_id = target_tenant_id and is_active
  ) then
    raise exception using errcode = '23503', message = 'service_not_found';
  end if;

  if target_staff_id is not null and not exists (
    select 1 from public.users
    where id = target_staff_id and tenant_id = target_tenant_id
  ) then
    raise exception using errcode = '23503', message = 'staff_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_tenant_id::text, 0));

  select coalesce(max(position), 0) + 1 into next_position
  from public.walk_in_queue
  where tenant_id = target_tenant_id
    and status in ('waiting', 'ready', 'in_service');

  insert into public.walk_in_queue (
    tenant_id, client_name, service_id, staff_id, station_name,
    position, estimated_wait_minutes, created_by
  )
  values (
    target_tenant_id, btrim(target_client_name), target_service_id,
    target_staff_id, nullif(btrim(target_station_name), ''),
    next_position, target_estimated_wait_minutes, (select auth.uid())
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.move_walk_in(
  target_walk_in_id uuid,
  direction integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_tenant_id uuid;
  current_position integer;
  neighbor_id uuid;
  neighbor_position integer;
begin
  if direction not in (-1, 1) then
    raise exception using errcode = '22023', message = 'invalid_direction';
  end if;

  select queue.tenant_id, queue.position
  into target_tenant_id, current_position
  from public.walk_in_queue as queue
  where queue.id = target_walk_in_id
    and queue.status in ('waiting', 'ready')
    and (select private.is_tenant_member(queue.tenant_id))
  for update;

  if target_tenant_id is null then
    raise exception using errcode = '22023', message = 'walk_in_not_movable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_tenant_id::text, 0));

  if direction = -1 then
    select id, position into neighbor_id, neighbor_position
    from public.walk_in_queue
    where tenant_id = target_tenant_id
      and status in ('waiting', 'ready')
      and position < current_position
    order by position desc
    limit 1
    for update;
  else
    select id, position into neighbor_id, neighbor_position
    from public.walk_in_queue
    where tenant_id = target_tenant_id
      and status in ('waiting', 'ready')
      and position > current_position
    order by position
    limit 1
    for update;
  end if;

  if neighbor_id is null then return; end if;

  update public.walk_in_queue
  set position = case
    when id = target_walk_in_id then neighbor_position
    when id = neighbor_id then current_position
  end,
  updated_at = now()
  where id in (target_walk_in_id, neighbor_id);
end;
$$;

create or replace function public.assign_walk_in(
  target_walk_in_id uuid,
  target_staff_id uuid,
  target_station_name text,
  target_estimated_wait_minutes integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_tenant_id uuid;
begin
  select tenant_id into target_tenant_id
  from public.walk_in_queue
  where id = target_walk_in_id
    and status in ('waiting', 'ready')
    and (select private.is_tenant_member(tenant_id));

  if target_tenant_id is null then
    raise exception using errcode = '22023', message = 'walk_in_not_assignable';
  end if;

  if target_staff_id is not null and not exists (
    select 1 from public.users where id = target_staff_id and tenant_id = target_tenant_id
  ) then
    raise exception using errcode = '23503', message = 'staff_not_found';
  end if;

  if target_estimated_wait_minutes not between 0 and 720 then
    raise exception using errcode = '22023', message = 'invalid_wait';
  end if;

  update public.walk_in_queue
  set staff_id = target_staff_id,
      station_name = nullif(btrim(target_station_name), ''),
      estimated_wait_minutes = target_estimated_wait_minutes,
      updated_at = now()
  where id = target_walk_in_id and tenant_id = target_tenant_id;
end;
$$;

create or replace function public.set_walk_in_status(
  target_walk_in_id uuid,
  target_status text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status text;
begin
  select status into current_status
  from public.walk_in_queue
  where id = target_walk_in_id
    and (select private.is_tenant_member(tenant_id))
  for update;

  if current_status is null
     or target_status not in ('waiting', 'ready', 'in_service', 'completed', 'removed')
     or not (
       (current_status in ('waiting', 'ready') and target_status in ('waiting', 'ready', 'in_service', 'removed'))
       or (current_status = 'in_service' and target_status in ('completed', 'removed'))
     ) then
    raise exception using errcode = '22023', message = 'invalid_walk_in_transition';
  end if;

  update public.walk_in_queue
  set status = target_status,
      started_at = case when target_status = 'in_service' then coalesce(started_at, now()) else started_at end,
      completed_at = case when target_status = 'completed' then now() else completed_at end,
      updated_at = now()
  where id = target_walk_in_id;
end;
$$;

revoke all on function public.enqueue_walk_in(text, uuid, uuid, text, integer) from public, anon;
revoke all on function public.move_walk_in(uuid, integer) from public, anon;
revoke all on function public.assign_walk_in(uuid, uuid, text, integer) from public, anon;
revoke all on function public.set_walk_in_status(uuid, text) from public, anon;

grant execute on function public.enqueue_walk_in(text, uuid, uuid, text, integer) to authenticated;
grant execute on function public.move_walk_in(uuid, integer) to authenticated;
grant execute on function public.assign_walk_in(uuid, uuid, text, integer) to authenticated;
grant execute on function public.set_walk_in_status(uuid, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'walk_in_queue'
  ) then
    alter publication supabase_realtime add table public.walk_in_queue;
  end if;
end
$$;

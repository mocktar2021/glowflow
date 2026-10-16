-- GLOW-22 real-database regression coverage for optional service staff assignments.
-- schema-database.test.mjs runs this only in its fresh disposable localhost database.

insert into auth.users(id,email) values
('20000000-0000-0000-0000-000000000004','staff-a-2@example.invalid');

insert into public.users(id,tenant_id,full_name,email,role) values
('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Staff A 2','staff-a-2@example.invalid','staff');

insert into public.staff_working_hours(
  id,tenant_id,staff_id,weekday,start_local,end_local,is_enabled
) values (
  '60000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000004',
  1,'09:00','17:00',true
);

insert into public.service_staff(service_id,staff_id,tenant_id) values (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001'
);

set role service_role;

select public.test_assert(
  exists (
    select 1 from public.get_public_booking_slots(
      'fixture-a',
      '40000000-0000-0000-0000-000000000001',
      current_date + (8 - extract(dow from current_date)::integer)
    )
  ),
  'configured eligible staff has public availability'
);

select public.test_assert(
  not exists (
    select 1 from public.get_public_booking_slots(
      'fixture-a',
      '40000000-0000-0000-0000-000000000001',
      current_date + (8 - extract(dow from current_date)::integer)
    )
    where staff_id <> '20000000-0000-0000-0000-000000000002'
  ),
  'configured service availability excludes ineligible staff'
);

do $$
declare
  selected_start timestamptz;
  created_id uuid;
begin
  select slot_start into selected_start
  from public.get_public_booking_slots(
    'fixture-a',
    '40000000-0000-0000-0000-000000000001',
    current_date + (8 - extract(dow from current_date)::integer)
  )
  where staff_id = '20000000-0000-0000-0000-000000000002'
  order by slot_start
  limit 1;

  select appointment_id into created_id
  from public.create_public_appointment(
    'fixture-a',
    '40000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    selected_start,
    'Eligible Fixture',
    null,
    'eligible@example.invalid',
    'en',
    '70000000-0000-0000-0000-000000000001'
  );

  perform public.test_assert(created_id is not null, 'configured eligible staff booking succeeds');
end $$;

do $$
begin
  perform * from public.create_public_appointment(
    'fixture-a',
    '40000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000004',
    (current_date + (8 - extract(dow from current_date)::integer) + time '11:00') at time zone 'America/New_York',
    'Ineligible Fixture',
    null,
    'ineligible@example.invalid',
    'en',
    '70000000-0000-0000-0000-000000000002'
  );
  raise exception 'assertion failed: forged ineligible staff booking was accepted';
exception
  when foreign_key_violation then
    if sqlerrm <> 'public_staff_not_eligible' then
      raise exception 'unexpected rejection for ineligible staff: %', sqlerrm;
    end if;
end $$;

reset role;
delete from public.service_staff
where tenant_id = '10000000-0000-0000-0000-000000000001'
  and service_id = '40000000-0000-0000-0000-000000000001';
set role service_role;

select public.test_assert(
  exists (
    select 1 from public.get_public_booking_slots(
      'fixture-a',
      '40000000-0000-0000-0000-000000000001',
      current_date + (8 - extract(dow from current_date)::integer)
    )
    where staff_id = '20000000-0000-0000-0000-000000000002'
  )
  and exists (
    select 1 from public.get_public_booking_slots(
      'fixture-a',
      '40000000-0000-0000-0000-000000000001',
      current_date + (8 - extract(dow from current_date)::integer)
    )
    where staff_id = '20000000-0000-0000-0000-000000000004'
  ),
  'service without assignments remains available to the whole scheduled team'
);

do $$
declare created_id uuid;
begin
  select appointment_id into created_id
  from public.create_public_appointment(
    'fixture-a',
    '40000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000004',
    (current_date + (8 - extract(dow from current_date)::integer) + time '11:00') at time zone 'America/New_York',
    'Whole Team Fixture',
    null,
    'whole-team@example.invalid',
    'es',
    '70000000-0000-0000-0000-000000000003'
  );
  perform public.test_assert(created_id is not null, 'whole-team fallback accepts scheduled tenant staff');
end $$;

do $$
begin
  perform * from public.create_public_appointment(
    'fixture-a',
    '40000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003',
    (current_date + (8 - extract(dow from current_date)::integer) + time '12:00') at time zone 'America/New_York',
    'Cross Tenant Fixture',
    null,
    'cross-tenant@example.invalid',
    'fr',
    '70000000-0000-0000-0000-000000000004'
  );
  raise exception 'assertion failed: cross-tenant staff booking was accepted';
exception
  when foreign_key_violation then
    if sqlerrm <> 'public_staff_not_found' then
      raise exception 'unexpected rejection for cross-tenant staff: %', sqlerrm;
    end if;
end $$;

do $$
begin
  perform * from public.create_public_appointment(
    'fixture-a',
    '40000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    (current_date + (8 - extract(dow from current_date)::integer) + time '13:00') at time zone 'America/New_York',
    'Cross Tenant Service Fixture',
    null,
    'cross-service@example.invalid',
    'fr',
    '70000000-0000-0000-0000-000000000005'
  );
  raise exception 'assertion failed: cross-tenant service booking was accepted';
exception
  when foreign_key_violation then
    if sqlerrm <> 'public_service_not_found' then
      raise exception 'unexpected rejection for cross-tenant service: %', sqlerrm;
    end if;
end $$;

reset role;

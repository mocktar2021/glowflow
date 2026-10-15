-- GLOW-22 real-database coverage for server-enforced public slot integrity.
-- This file runs only in the disposable localhost database created by rls-run.mjs.

insert into auth.users(id,email) values
('20000000-0000-0000-0000-000000000005','slot-staff@example.invalid');

insert into public.users(id,tenant_id,full_name,email,role) values
('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','Slot Staff','slot-staff@example.invalid','staff');

insert into public.staff_working_hours(
  id,tenant_id,staff_id,weekday,start_local,end_local,is_enabled
) values (
  '60000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000005',
  1,'09:00','15:00',true
);

insert into public.station_working_hours(
  id,tenant_id,station_name,weekday,start_local,end_local,is_enabled
) values (
  '62000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000001',
  'Integrity Chair',1,'09:30','15:30',true
);

insert into public.services(
  id,tenant_id,title_json,duration_minutes,sanitation_buffer_minutes,
  price,category,currency,station_name,is_active
) values (
  '40000000-0000-0000-0000-000000000005',
  '10000000-0000-0000-0000-000000000001',
  '{"fr":"Intégrité","en":"Integrity","es":"Integridad"}',
  45,15,4500,'hair','USD','Integrity Chair',true
);

set role service_role;

do $$
declare
  test_date date := current_date + (8 - extract(dow from current_date)::integer);
  valid_start timestamptz;
  created_id uuid;
  retry_id uuid;
begin
  valid_start := (test_date + time '10:00') at time zone 'America/New_York';

  perform public.test_assert(
    exists (
      select 1
      from public.get_public_booking_slots(
        'fixture-a',
        '40000000-0000-0000-0000-000000000005',
        test_date
      )
      where staff_id = '20000000-0000-0000-0000-000000000002'
        and slot_start = valid_start
    ),
    'valid service, staff, and local-date slot is exposed'
  );

  perform public.test_assert(
    not exists (
      select 1
      from public.get_public_booking_slots(
        'fixture-a',
        '40000000-0000-0000-0000-000000000005',
        test_date
      )
      where staff_id = '20000000-0000-0000-0000-000000000002'
        and slot_start = (test_date + time '09:00') at time zone 'America/New_York'
    ),
    'station opening time removes an otherwise scheduled staff slot'
  );

  perform public.test_assert(
    exists (
      select 1
      from public.get_public_booking_slots(
        'fixture-a',
        '40000000-0000-0000-0000-000000000005',
        test_date
      )
      where staff_id = '20000000-0000-0000-0000-000000000002'
        and slot_start = (test_date + time '14:30') at time zone 'America/New_York'
    )
    and not exists (
      select 1
      from public.get_public_booking_slots(
        'fixture-a',
        '40000000-0000-0000-0000-000000000005',
        test_date
      )
      where staff_id = '20000000-0000-0000-0000-000000000002'
        and slot_start = (test_date + time '15:00') at time zone 'America/New_York'
    ),
    'station end time includes the 45-minute service and 15-minute buffer'
  );

  perform public.test_assert(
    exists (
      select 1
      from public.get_public_booking_slots(
        'fixture-a',
        '40000000-0000-0000-0000-000000000005',
        test_date
      )
      where staff_id = '20000000-0000-0000-0000-000000000005'
        and slot_start = (test_date + time '14:00') at time zone 'America/New_York'
    )
    and not exists (
      select 1
      from public.get_public_booking_slots(
        'fixture-a',
        '40000000-0000-0000-0000-000000000005',
        test_date
      )
      where staff_id = '20000000-0000-0000-0000-000000000005'
        and slot_start = (test_date + time '14:30') at time zone 'America/New_York'
    ),
    'staff end time includes the 45-minute service and 15-minute buffer'
  );

  select appointment_id into created_id
  from public.create_public_appointment(
    'fixture-a',
    '40000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000002',
    valid_start,
    'Valid Slot Fixture',
    null,
    'valid-slot@example.invalid',
    'en',
    '70000000-0000-0000-0000-000000000010'
  );

  perform public.test_assert(created_id is not null, 'valid exposed slot booking succeeds');
  perform public.test_assert(
    exists (
      select 1
      from public.appointments
      where id = created_id
        and start_time = valid_start
        and end_time = valid_start + interval '45 minutes'
        and buffer_end_time = valid_start + interval '60 minutes'
        and station_name = 'Integrity Chair'
    ),
    'appointment stores trusted duration, buffer, and station values'
  );

  -- The appointment has consumed its slot, but the same request key must still
  -- return the original result before availability is evaluated again.
  select appointment_id into retry_id
  from public.create_public_appointment(
    'fixture-a',
    '40000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000002',
    valid_start,
    'Valid Slot Fixture',
    null,
    'valid-slot@example.invalid',
    'en',
    '70000000-0000-0000-0000-000000000010'
  );

  perform public.test_assert(retry_id = created_id, 'idempotent retry returns the original appointment');
  perform public.test_assert(
    (select count(*) from public.appointments
      where public_booking_request_key = '70000000-0000-0000-0000-000000000010') = 1,
    'idempotent retry creates no duplicate appointment'
  );
end $$;

do $$
declare test_date date := current_date + (8 - extract(dow from current_date)::integer);
begin
  perform * from public.create_public_appointment(
    'fixture-a','40000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000005',
    (test_date + time '12:15') at time zone 'America/New_York',
    'Off Grid Fixture',null,'off-grid@example.invalid','en',
    '70000000-0000-0000-0000-000000000011'
  );
  raise exception 'assertion failed: forged off-grid booking was accepted';
exception
  when exclusion_violation then
    if sqlerrm <> 'public_time_unavailable' then raise; end if;
end $$;

do $$
declare test_date date := current_date + (8 - extract(dow from current_date)::integer);
begin
  perform * from public.create_public_appointment(
    'fixture-a','40000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000005',
    (test_date + time '15:00') at time zone 'America/New_York',
    'Outside Hours Fixture',null,'outside-hours@example.invalid','en',
    '70000000-0000-0000-0000-000000000012'
  );
  raise exception 'assertion failed: outside staff hours booking was accepted';
exception
  when exclusion_violation then
    if sqlerrm <> 'public_time_unavailable' then raise; end if;
end $$;

do $$
declare test_date date := current_date + (8 - extract(dow from current_date)::integer);
begin
  -- Staff 5 is otherwise free, but staff 2 has Integrity Chair reserved until
  -- 11:00, including the sanitation buffer.
  perform * from public.create_public_appointment(
    'fixture-a','40000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000005',
    (test_date + time '10:30') at time zone 'America/New_York',
    'Station Conflict Fixture',null,'station-conflict@example.invalid','en',
    '70000000-0000-0000-0000-000000000013'
  );
  raise exception 'assertion failed: station buffer conflict booking was accepted';
exception
  when exclusion_violation then
    if sqlerrm <> 'public_time_unavailable' then raise; end if;
end $$;

select public.test_assert(
  exists (
    select 1
    from public.get_public_booking_slots(
      'fixture-a','40000000-0000-0000-0000-000000000005',
      current_date + (8 - extract(dow from current_date)::integer)
    )
    where staff_id = '20000000-0000-0000-0000-000000000005'
      and slot_start = (
        current_date + (8 - extract(dow from current_date)::integer) + time '11:00'
      ) at time zone 'America/New_York'
  ),
  'station becomes available at the prior appointment buffer boundary'
);

do $$
declare test_date date := current_date + (8 - extract(dow from current_date)::integer);
begin
  perform * from public.create_public_appointment(
    'fixture-a','40000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000003',
    (test_date + time '12:00') at time zone 'America/New_York',
    'Cross Tenant Slot Fixture',null,'cross-slot@example.invalid','en',
    '70000000-0000-0000-0000-000000000014'
  );
  raise exception 'assertion failed: cross-tenant staff booking was accepted';
exception
  when foreign_key_violation then
    if sqlerrm <> 'public_staff_not_found' then raise; end if;
end $$;

reset role;

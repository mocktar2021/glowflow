-- Synthetic data only. All application objects come from the baseline and migrations.
create function public.test_assert(ok boolean, label text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'assertion failed: %', label; end if;
end $$;
create function public.test_denied(statement text) returns void
language plpgsql security invoker as $$ begin
  begin
    execute statement;
  exception when insufficient_privilege then return;
  end;
  raise exception 'expected permission denial: %', statement;
end $$;

insert into auth.users(id,email) values
('20000000-0000-0000-0000-000000000001','owner-a@example.invalid'),
('20000000-0000-0000-0000-000000000002','staff-a@example.invalid'),
('20000000-0000-0000-0000-000000000003','owner-b@example.invalid');
insert into public.tenants(id,name,slug,owner_id,country_code,currency,time_zone) values
('10000000-0000-0000-0000-000000000001','Fixture A','fixture-a','20000000-0000-0000-0000-000000000001','US','USD','America/New_York'),
('10000000-0000-0000-0000-000000000002','Fixture B','fixture-b','20000000-0000-0000-0000-000000000003','US','USD','America/New_York');
insert into public.users(id,tenant_id,full_name,email,role) values
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Owner A','owner-a@example.invalid','owner'),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Staff A','staff-a@example.invalid','staff'),
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Owner B','owner-b@example.invalid','owner');
insert into public.clients(id,tenant_id,full_name,notes)
select ('30000000-0000-0000-0000-00000000000'||i)::uuid, id, 'Private client '||i, 'private notes'
from public.tenants cross join lateral (select case when slug='fixture-a' then 1 else 2 end i) fixture;
insert into public.services(id,tenant_id,title_json,duration_minutes,price,category,currency)
select ('40000000-0000-0000-0000-00000000000'||i)::uuid, tenant_id, '{"fr":"Coupe","en":"Cut","es":"Corte"}',30,5000,'hair','USD'
from public.clients cross join lateral (select right(id::text,1)::int i) fixture;
insert into public.appointments(id,tenant_id,client_id,service_id,staff_id,start_time,end_time)
select ('50000000-0000-0000-0000-00000000000'||right(c.id::text,1))::uuid,c.tenant_id,c.id,s.id,t.owner_id,now()+interval '30 days',now()+interval '30 days 30 minutes'
from public.clients c join public.services s using(tenant_id) join public.tenants t on t.id=c.tenant_id;
insert into public.invoices(tenant_id,appointment_id,invoice_number,total_amount,currency)
select tenant_id,id,'TEST-1',5000,'USD' from public.appointments;
insert into public.staff_working_hours(id,tenant_id,staff_id,weekday,start_local,end_local) values
('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',1,'09:00','17:00'),
('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003',1,'09:00','17:00');
insert into public.staff_schedule_exceptions(id,tenant_id,staff_id,kind,starts_at,ends_at,note) values
('61000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','break',now()+interval '31 days',now()+interval '31 days 30 minutes','private A'),
('61000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','break',now()+interval '31 days',now()+interval '31 days 30 minutes','private B');
insert into public.station_working_hours(id,tenant_id,station_name,weekday,start_local,end_local) values
('62000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Chair A',1,'09:00','17:00'),
('62000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Chair B',1,'09:00','17:00');
insert into public.walk_in_queue(id,tenant_id,client_name,service_id,staff_id,position,created_by) values
('63000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Walk in A','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',1,'20000000-0000-0000-0000-000000000001'),
('63000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Walk in B','40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003',1,'20000000-0000-0000-0000-000000000003');
insert into public.salon_public_profiles(tenant_id,slug,business_name,country_code,city,postal_code,categories,is_published,published_at) values
('10000000-0000-0000-0000-000000000001','fixture-a-public','Fixture A Public','US','New York','10001',array['hair'],true,now()),
('10000000-0000-0000-0000-000000000002','fixture-b-private','Fixture B Private','US','New York','10002',array['hair'],false,null);
insert into storage.objects(id,bucket_id,name) values
('64000000-0000-0000-0000-000000000001','salon-public-media','10000000-0000-0000-0000-000000000001/a.webp'),
('64000000-0000-0000-0000-000000000002','salon-public-media','10000000-0000-0000-0000-000000000002/b.webp');

-- Each real identity can read its tenant, but neither read nor change the other.
set role authenticated;
do $$
declare who text; own_tenant uuid; other_tenant uuid; table_name text; n integer;
begin
  foreach who in array array['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003'] loop
    perform set_config('request.jwt.claim.sub',who,false);
    own_tenant := case when right(who,1)='3' then '10000000-0000-0000-0000-000000000002' else '10000000-0000-0000-0000-000000000001' end;
    other_tenant := case when right(who,1)='3' then '10000000-0000-0000-0000-000000000001' else '10000000-0000-0000-0000-000000000002' end;
    foreach table_name in array array['clients','services','appointments','invoices','users'] loop
      execute format('select count(*) from public.%I where tenant_id=$1',table_name) into n using own_tenant;
      perform public.test_assert(n>0,who||' reads own '||table_name);
      execute format('select count(*) from public.%I where tenant_id=$1',table_name) into n using other_tenant;
      perform public.test_assert(n=0,who||' cannot read foreign '||table_name);
      execute format('delete from public.%I where tenant_id=$1',table_name) using other_tenant;
      get diagnostics n = row_count;
      perform public.test_assert(n=0,who||' cannot delete foreign '||table_name);
    end loop;
    update public.clients set notes='forbidden' where tenant_id=other_tenant;
    get diagnostics n = row_count;
    perform public.test_assert(n=0,'cross-tenant update invisible');
    perform public.test_denied(format('insert into public.clients(tenant_id,full_name) values(%L,%L)',other_tenant,'Forbidden client'));
    perform public.test_denied(format('update public.clients set tenant_id=%L where tenant_id=%L',other_tenant,own_tenant));
    insert into public.clients(tenant_id,full_name) values(own_tenant,'Permitted temporary client');
    update public.clients set notes='permitted' where tenant_id=own_tenant and full_name='Permitted temporary client';
    get diagnostics n = row_count;
    perform public.test_assert(n=1,'member can update own client');
    delete from public.clients where tenant_id=own_tenant and full_name='Permitted temporary client';
    get diagnostics n = row_count;
    perform public.test_assert(n=1,'member can delete own client');
    perform public.test_denied('update public.users set role=''owner'' where id=auth.uid()');
    perform public.test_denied(format('update public.users set tenant_id=%L where id=auth.uid()',other_tenant));
  end loop;
end $$;

-- Staff can read catalog but only the owner can manage it.
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select public.test_denied('insert into public.services(tenant_id,title_json,duration_minutes,price,category,currency) values(''10000000-0000-0000-0000-000000000001'',''{"fr":"Denied"}'',30,100,''hair'',''USD'')');
with changed as (update public.services set price=1 returning id)
select public.test_assert((select count(*) from changed)=0,'staff cannot edit catalog');
with removed as (delete from public.invoices returning id)
select public.test_assert((select count(*) from removed)=0,'staff cannot delete invoices');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
with changed as (update public.services set price=5500 where tenant_id='10000000-0000-0000-0000-000000000001' returning id)
select public.test_assert((select count(*) from changed)=1,'owner can edit own catalog');

-- Scheduling is tenant-readable but owner-managed.
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select public.test_assert((select count(*) from public.staff_working_hours)=1,'staff reads own working hours');
select public.test_assert((select count(*) from public.staff_schedule_exceptions)=1,'staff reads own exceptions');
select public.test_assert((select count(*) from public.station_working_hours)=1,'staff reads own station hours');
select public.test_denied('insert into public.staff_working_hours(tenant_id,staff_id,weekday,start_local,end_local) values(''10000000-0000-0000-0000-000000000001'',''20000000-0000-0000-0000-000000000002'',2,''09:00'',''17:00'')');
with changed as (update public.station_working_hours set end_local='18:00' returning id)
select public.test_assert((select count(*) from changed)=0,'staff cannot edit station hours');
with removed as (delete from public.staff_schedule_exceptions returning id)
select public.test_assert((select count(*) from removed)=0,'staff cannot delete exceptions');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
with changed as (update public.station_working_hours set end_local='18:00' where tenant_id='10000000-0000-0000-0000-000000000001' returning id)
select public.test_assert((select count(*) from changed)=1,'owner edits own station hours');
select public.test_denied('update public.staff_working_hours set tenant_id=''10000000-0000-0000-0000-000000000002'' where id=''60000000-0000-0000-0000-000000000001''');

-- Staff may manage their tenant queue, but cannot forge creators or reach another tenant.
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select public.test_assert((select count(*) from public.walk_in_queue)=1,'staff reads own queue only');
insert into public.walk_in_queue(tenant_id,client_name,service_id,position,created_by)
values('10000000-0000-0000-0000-000000000001','Permitted walk in','40000000-0000-0000-0000-000000000001',2,'20000000-0000-0000-0000-000000000002');
select public.test_denied('insert into public.walk_in_queue(tenant_id,client_name,service_id,position,created_by) values(''10000000-0000-0000-0000-000000000001'',''Forged walk in'',''40000000-0000-0000-0000-000000000001'',3,''20000000-0000-0000-0000-000000000001'')');
select public.test_denied('insert into public.walk_in_queue(tenant_id,client_name,service_id,position,created_by) values(''10000000-0000-0000-0000-000000000002'',''Foreign walk in'',''40000000-0000-0000-0000-000000000002'',2,''20000000-0000-0000-0000-000000000002'')');
with changed as (update public.walk_in_queue set status='ready' where client_name='Permitted walk in' returning id)
select public.test_assert((select count(*) from changed)=1,'staff updates own queue');
with removed as (delete from public.walk_in_queue where client_name='Permitted walk in' returning id)
select public.test_assert((select count(*) from removed)=1,'staff deletes own queue');
select public.test_denied('update public.walk_in_queue set tenant_id=''10000000-0000-0000-0000-000000000002'' where id=''63000000-0000-0000-0000-000000000001''');

-- Publishing is owner-only; signed-out visitors see published profiles only.
select public.test_assert((select count(*) from public.salon_public_profiles)=1,'staff sees own profile only');
with changed as (update public.salon_public_profiles set business_name='Denied edit' returning tenant_id)
select public.test_assert((select count(*) from changed)=0,'staff cannot edit public profile');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
with changed as (update public.salon_public_profiles set business_name='Fixture A Updated' where tenant_id='10000000-0000-0000-0000-000000000001' returning tenant_id)
select public.test_assert((select count(*) from changed)=1,'owner edits own public profile');
select public.test_denied('update public.salon_public_profiles set tenant_id=''10000000-0000-0000-0000-000000000002'' where tenant_id=''10000000-0000-0000-0000-000000000001''');

-- Storage paths are owned by the salon owner. Staff and other owners cannot cross folders.
select public.test_assert((select count(*) from storage.objects)=1,'owner sees own media only');
insert into storage.objects(bucket_id,name) values('salon-public-media','10000000-0000-0000-0000-000000000001/new.webp');
with changed as (update storage.objects set name='10000000-0000-0000-0000-000000000001/renamed.webp' where name='10000000-0000-0000-0000-000000000001/new.webp' returning id)
select public.test_assert((select count(*) from changed)=1,'owner updates own media');
select public.test_denied('insert into storage.objects(bucket_id,name) values(''salon-public-media'',''10000000-0000-0000-0000-000000000002/foreign.webp'')');
select public.test_denied('update storage.objects set name=''10000000-0000-0000-0000-000000000002/moved.webp'' where name=''10000000-0000-0000-0000-000000000001/renamed.webp''');
with removed as (delete from storage.objects where name='10000000-0000-0000-0000-000000000001/renamed.webp' returning id)
select public.test_assert((select count(*) from removed)=1,'owner deletes own media');
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select public.test_assert((select count(*) from storage.objects)=0,'staff sees no owner media');
select public.test_denied('insert into storage.objects(bucket_id,name) values(''salon-public-media'',''10000000-0000-0000-0000-000000000001/staff.webp'')');

-- Authenticated identities with no membership and signed-out clients see no private data.
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
select public.test_assert((select count(*) from public.clients)=0,'unaffiliated identity has no clients');
select public.test_assert((select count(*) from public.appointments)=0,'unaffiliated identity has no appointments');
select public.test_assert((select count(*) from public.invoices)=0,'unaffiliated identity has no invoices');
reset role;
set role anon;
select public.test_denied('select * from public.clients');
select public.test_denied('select * from public.users');
select public.test_denied('select * from public.appointments');
select public.test_denied('select * from public.invoices');
select public.test_denied('select stripe_account_id from public.tenants');
select public.test_denied('insert into public.clients(tenant_id,full_name) values(''10000000-0000-0000-0000-000000000001'',''Anonymous client'')');
select public.test_denied('select * from public.staff_working_hours');
select public.test_denied('select * from public.staff_schedule_exceptions');
select public.test_denied('select * from public.station_working_hours');
select public.test_denied('select * from public.walk_in_queue');
select public.test_assert((select count(*) from public.salon_public_profiles)=1,'anonymous sees published profile only');
select public.test_assert((select count(*) from public.salon_public_profiles where slug='fixture-b-private')=0,'anonymous cannot see draft profile');
select public.test_assert((select count(*) from public.search_public_salons())=1,'anonymous search returns published salons');
select public.test_assert(not has_table_privilege('anon','public.salon_public_profiles','select'),'anonymous has no table-wide profile read');
select public.test_assert(has_column_privilege('anon','public.salon_public_profiles','business_name','select'),'anonymous reads allowlisted profile fields');
select public.test_denied('select created_at from public.salon_public_profiles');
select public.test_denied('insert into public.salon_public_profiles(tenant_id,slug,business_name,country_code,city,postal_code) values(''10000000-0000-0000-0000-000000000001'',''anon-profile'',''Anon profile'',''US'',''New York'',''10001'')');
select public.test_denied('select * from storage.objects');
select public.test_denied('insert into storage.objects(bucket_id,name) values(''salon-public-media'',''10000000-0000-0000-0000-000000000001/anon.webp'')');
reset role;
select public.test_assert((select count(*) from public.clients)=2,'denied operations preserved clients');
select public.test_assert((select count(*) from public.invoices)=2,'denied operations preserved invoices');
select public.test_assert((select count(*) from public.walk_in_queue)=2,'denied operations preserved queue');
select public.test_assert((select count(*) from storage.objects)=2,'owner media lifecycle and denied writes preserve fixtures');

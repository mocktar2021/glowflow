-- Minimal local dependency fixture; the repository's legacy schema.sql is malformed.
-- Run ONLY in a fresh disposable database. No remote or existing database reset.
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$;
create schema auth; create schema private; create schema extensions;
create extension btree_gist with schema extensions;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;
create table public.markets(country_code text primary key,status text,payment_methods text[]);
create table public.tenants(id uuid primary key,owner_id uuid,slug text,name text,country_code text,currency text,time_zone text,is_booking_enabled boolean);
create table public.users(id uuid,tenant_id uuid,primary key(id,tenant_id));
create table public.services(id uuid,tenant_id uuid,title_json jsonb,duration_minutes integer,sanitation_buffer_minutes integer,station_name text,deposit_amount integer,currency text,is_active boolean,primary key(id,tenant_id));
create table public.service_staff(tenant_id uuid,service_id uuid,staff_id uuid);
create table public.salon_public_profiles(tenant_id uuid,is_published boolean);
create table public.staff_working_hours(tenant_id uuid,staff_id uuid,weekday smallint,start_local time,end_local time,is_enabled boolean);
create table public.station_working_hours(tenant_id uuid,station_name text,weekday smallint,start_local time,end_local time,is_enabled boolean);
create table public.staff_schedule_exceptions(tenant_id uuid,staff_id uuid,starts_at timestamptz,ends_at timestamptz);
create table public.appointments(id uuid default gen_random_uuid(),tenant_id uuid,staff_id uuid,station_name text,start_time timestamptz,buffer_end_time timestamptz,status text);
grant select on public.tenants to authenticated;
insert into public.markets values('FR','active',array['cash','card']);
insert into public.tenants values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','fixture','Fixture','FR','EUR','UTC',true);
insert into public.users values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001');
insert into public.services values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"fr":"Coupe"}',30,10,'chair',1200,'EUR',true);
insert into public.service_staff select tenant_id,'30000000-0000-0000-0000-000000000001',id from public.users;
insert into public.salon_public_profiles values('10000000-0000-0000-0000-000000000001',true);
insert into public.staff_working_hours select tenant_id,id,day::smallint,'08:00','20:00',true from public.users cross join generate_series(0,6) day;

-- GLOW-23: isolated sandbox simulations. Never creates live clients/appointments.
create table public.stripe_sandbox_reservations (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 appointment_id uuid not null unique default gen_random_uuid(),
 client_id uuid not null default gen_random_uuid(),
 service_id uuid not null, staff_id uuid not null,
 request_key uuid not null,
 start_time timestamptz not null, end_time timestamptz not null,
 buffer_end_time timestamptz not null, station_name text,
 locale text not null check (locale in ('fr','en','es')),
 client_full_name text not null, client_phone text, client_email text,
 stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
 amount integer not null check (amount > 0),
 currency text not null check (currency ~ '^[A-Z]{3}$'),
 service_title jsonb not null,
 status text not null default 'reserved' check (status in ('reserved','pending','paid','expired','failed','reconciliation_required')),
 expires_at timestamptz not null default (now() + interval '35 minutes'),
 checkout_session_id text, payment_intent_id text, checkout_url text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,request_key), unique(stripe_account_id,checkout_session_id),
 unique(stripe_account_id,payment_intent_id),
 foreign key (service_id,tenant_id) references public.services(id,tenant_id),
 foreign key (staff_id,tenant_id) references public.users(id,tenant_id),
 check (start_time < end_time and end_time <= buffer_end_time),
 exclude using gist (tenant_id with =,staff_id with =,tstzrange(start_time,buffer_end_time,'[)') with &&)
 where (status in ('reserved','pending','paid')),
 exclude using gist (tenant_id with =,station_name with =,tstzrange(start_time,buffer_end_time,'[)') with &&)
 where (station_name is not null and status in ('reserved','pending','paid'))
);
create table public.stripe_sandbox_events (
 stripe_account_id text not null, event_id text not null,
 reservation_id uuid not null references public.stripe_sandbox_reservations(id),
 event_type text not null, created_at timestamptz not null default now(),
 primary key(stripe_account_id,event_id)
);
alter table public.stripe_sandbox_reservations enable row level security;
alter table public.stripe_sandbox_events enable row level security;
revoke all on public.stripe_sandbox_reservations,public.stripe_sandbox_events from public,anon,authenticated;
grant select on public.stripe_sandbox_reservations to authenticated;
create policy sandbox_reservation_owner_read on public.stripe_sandbox_reservations for select to authenticated
using (exists(select 1 from public.tenants t where t.id=tenant_id and t.owner_id=(select auth.uid())));
grant select,insert,update on public.stripe_sandbox_reservations,public.stripe_sandbox_events to service_role;

create function public.reserve_stripe_sandbox_booking(
 target_salon_slug text,target_service_id uuid,target_staff_id uuid,requested_start timestamptz,
 client_full_name text,client_phone text,client_email text,client_locale text,request_key uuid
) returns public.stripe_sandbox_reservations
language plpgsql security definer set search_path='' as $$
declare
 t public.tenants%rowtype; s public.services%rowtype;
 r public.stripe_sandbox_reservations%rowtype;
 account_id text; local_start timestamp; local_end timestamp; deadline timestamptz;
begin
 if request_key is null or requested_start is null or requested_start<=now() or requested_start>now()+interval '90 days'
 or client_full_name is null or char_length(btrim(client_full_name)) not between 2 and 120
 or client_locale is null or client_locale not in ('fr','en','es')
 or (nullif(btrim(client_phone),'') is null and nullif(btrim(client_email),'') is null)
 or char_length(coalesce(client_phone,''))>40 or char_length(coalesce(client_email,''))>254
 or (nullif(btrim(client_email),'') is not null and btrim(client_email)!~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then
 raise exception using errcode='22023',message='invalid_sandbox_booking'; end if;
 select * into t from public.tenants where slug=btrim(target_salon_slug);
 if not found then raise exception using errcode='23503',message='sandbox_service_not_found'; end if;
 -- Serialize all reservation transitions per tenant, then recheck idempotency.
 perform pg_advisory_xact_lock(hashtextextended('sandbox:'||t.id::text,0));
 select * into r from public.stripe_sandbox_reservations x where x.tenant_id=t.id and x.request_key=reserve_stripe_sandbox_booking.request_key for update;
 if found then
  if r.service_id is distinct from target_service_id or r.staff_id is distinct from target_staff_id
  or r.start_time is distinct from requested_start or r.locale is distinct from client_locale
  or r.client_full_name is distinct from btrim(client_full_name)
  or r.client_phone is distinct from nullif(btrim(client_phone),'')
  or r.client_email is distinct from nullif(lower(btrim(client_email)),'') then
   raise exception using errcode='22023',message='sandbox_request_mismatch'; end if;
  if r.status in ('expired','failed','reconciliation_required') or (r.status<>'paid' and r.expires_at<=now()) then
   raise exception using errcode='22023',message='sandbox_reservation_expired'; end if;
  return r;
 end if;
 select * into s from public.services where id=target_service_id and tenant_id=t.id and is_active;
 select c.stripe_account_id into account_id from public.stripe_sandbox_connections c where c.tenant_id=t.id;
 if s.id is null or not t.is_booking_enabled or account_id is null or s.deposit_amount<=0
 or s.currency<>t.currency
 or not exists(select 1 from public.markets m where m.country_code=t.country_code and m.status='active' and 'card'=any(m.payment_methods))
 or not exists(select 1 from public.salon_public_profiles p where p.tenant_id=t.id and p.is_published)
 or not exists(select 1 from public.service_staff ss where ss.tenant_id=t.id and ss.service_id=s.id and ss.staff_id=target_staff_id) then
 raise exception using errcode='22023',message='sandbox_payments_unavailable'; end if;
 deadline:=requested_start+make_interval(mins=>s.duration_minutes+s.sanitation_buffer_minutes);
 local_start:=requested_start at time zone t.time_zone; local_end:=deadline at time zone t.time_zone;
 if local_start::date<>local_end::date or not exists(select 1 from public.staff_working_hours h
 where h.tenant_id=t.id and h.staff_id=target_staff_id and h.is_enabled
 and h.weekday=extract(dow from local_start)::smallint and h.start_local<=local_start::time and h.end_local>=local_end::time)
 or not private.public_resource_available(t.id,target_staff_id,s.station_name,requested_start,deadline) then
 raise exception using errcode='23P01',message='sandbox_time_unavailable'; end if;
 update public.stripe_sandbox_reservations set status='expired',updated_at=now()
 where tenant_id=t.id and status in ('reserved','pending') and expires_at<=now();
 insert into public.stripe_sandbox_reservations(tenant_id,service_id,staff_id,request_key,start_time,end_time,buffer_end_time,
 station_name,locale,client_full_name,client_phone,client_email,stripe_account_id,amount,currency,service_title)
 values(t.id,s.id,target_staff_id,request_key,requested_start,requested_start+make_interval(mins=>s.duration_minutes),deadline,
 nullif(btrim(s.station_name),''),client_locale,btrim(client_full_name),nullif(btrim(client_phone),''),nullif(lower(btrim(client_email)),''),
 account_id,s.deposit_amount,t.currency,s.title_json) returning * into r;
 return r;
end; $$;

create function public.attach_stripe_sandbox_checkout(target_reservation_id uuid,target_session_id text,target_checkout_url text)
returns public.stripe_sandbox_reservations language plpgsql security definer set search_path='' as $$
declare r public.stripe_sandbox_reservations%rowtype; tenant uuid;
begin
 select tenant_id into tenant from public.stripe_sandbox_reservations where id=target_reservation_id;
 if tenant is null then raise exception using errcode='23503',message='sandbox_reservation_not_found'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sandbox:'||tenant::text,0));
 select * into r from public.stripe_sandbox_reservations where id=target_reservation_id for update;
 if target_session_id is null or target_session_id!~'^cs_test_[A-Za-z0-9]+$'
 or target_checkout_url is null or target_checkout_url!~'^https://checkout[.]stripe[.]com/'
 or (r.checkout_session_id is not null and r.checkout_session_id<>target_session_id) then
 raise exception using errcode='22023',message='sandbox_session_mismatch'; end if;
 update public.stripe_sandbox_reservations set checkout_session_id=target_session_id,checkout_url=target_checkout_url,
 status=case when status='reserved' and expires_at>now() then 'pending'
 when status='reserved' then 'expired' else status end,updated_at=now()
 where id=r.id returning * into r;
 return r;
end; $$;

create function public.process_stripe_sandbox_event(
 target_event_id text,target_account_id text,target_reservation_id uuid,target_session_id text,
 target_payment_intent_id text,target_event_type text,target_amount integer,target_currency text,
 target_tenant_id uuid,target_appointment_id uuid,target_client_id uuid,target_livemode boolean
) returns public.stripe_sandbox_reservations language plpgsql security definer set search_path='' as $$
declare r public.stripe_sandbox_reservations%rowtype; tenant uuid; receipt public.stripe_sandbox_events%rowtype;
begin
 select tenant_id into tenant from public.stripe_sandbox_reservations where id=target_reservation_id;
 if tenant is null then raise exception using errcode='23503',message='sandbox_reservation_not_found'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sandbox:'||tenant::text,0));
 select * into r from public.stripe_sandbox_reservations where id=target_reservation_id for update;
 if target_livemode is distinct from false or target_event_id is null or target_event_id!~'^evt_[A-Za-z0-9]+$'
 or r.tenant_id is distinct from target_tenant_id or r.appointment_id is distinct from target_appointment_id
 or r.client_id is distinct from target_client_id or r.stripe_account_id is distinct from target_account_id
 or target_session_id is null or target_session_id!~'^cs_test_[A-Za-z0-9]+$'
 or (r.checkout_session_id is not null and r.checkout_session_id<>target_session_id)
 or r.amount is distinct from target_amount or lower(r.currency) is distinct from lower(target_currency)
 or target_event_type is null or target_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired')
 or (target_payment_intent_id is not null and target_payment_intent_id!~'^pi_[A-Za-z0-9]+$')
 or (r.payment_intent_id is not null and target_payment_intent_id is not null and r.payment_intent_id<>target_payment_intent_id)
 or (target_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') and target_payment_intent_id is null) then
 raise exception using errcode='22023',message='sandbox_event_mismatch'; end if;
 select * into receipt from public.stripe_sandbox_events where stripe_account_id=target_account_id and event_id=target_event_id;
 if found then
 if receipt.reservation_id<>r.id or receipt.event_type<>target_event_type then
 raise exception using errcode='22023',message='sandbox_event_replay_mismatch'; end if;
 return r; end if;
 insert into public.stripe_sandbox_events(stripe_account_id,event_id,reservation_id,event_type)
 values(target_account_id,target_event_id,r.id,target_event_type);
 if r.status<>'paid' and target_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then
  if r.status in ('expired','failed','reconciliation_required') or r.expires_at<=now()
   or not private.public_resource_available(r.tenant_id,r.staff_id,r.station_name,r.start_time,r.buffer_end_time) then
   r.status:='reconciliation_required'; else r.status:='paid'; end if;
 elsif r.status in ('reserved','pending') then
  r.status:=case when target_event_type='checkout.session.expired' then 'expired' else 'failed' end;
 end if;
 update public.stripe_sandbox_reservations set status=r.status,checkout_session_id=target_session_id,
 payment_intent_id=coalesce(target_payment_intent_id,payment_intent_id),updated_at=now() where id=r.id returning * into r;
 return r;
end; $$;

revoke all on function public.reserve_stripe_sandbox_booking(text,uuid,uuid,timestamptz,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.attach_stripe_sandbox_checkout(uuid,text,text) from public,anon,authenticated;
revoke all on function public.process_stripe_sandbox_event(text,text,uuid,text,text,text,integer,text,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.reserve_stripe_sandbox_booking(text,uuid,uuid,timestamptz,text,text,text,text,uuid) to service_role;
grant execute on function public.attach_stripe_sandbox_checkout(uuid,text,text) to service_role;
grant execute on function public.process_stripe_sandbox_event(text,text,uuid,text,text,text,integer,text,uuid,uuid,uuid,boolean) to service_role;
-- Rollback before activation: drop the three functions, events table, then reservations table.
-- After activation preserve the ledger and correlation records for reconciliation.

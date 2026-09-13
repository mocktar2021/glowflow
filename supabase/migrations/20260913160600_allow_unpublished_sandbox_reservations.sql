-- GLOW-23: owner-only sandbox tests do not publish or require a public profile.
-- The existing service-role-only grant and API owner checks remain authoritative.
create or replace function public.reserve_stripe_sandbox_booking(
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


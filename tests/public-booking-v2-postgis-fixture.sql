-- Disposable localhost-only data for the production route -> real RPC seam.
-- These values are synthetic test fixtures, not hosted policy recommendations.
insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-000000000001', 'route-owner@example.invalid'),
  ('20000000-0000-0000-0000-000000000002', 'route-staff@example.invalid');

insert into public.tenants
  (id, name, slug, owner_id, country_code, currency, time_zone)
values
  ('10000000-0000-0000-0000-000000000001', 'Route Fixture Salon', 'route-fixture',
   '20000000-0000-0000-0000-000000000001', 'US', 'USD', 'America/New_York');

insert into public.users (id, tenant_id, full_name, email, role) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Fixture Owner', 'route-owner@example.invalid', 'owner'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'Fixture Staff', 'route-staff@example.invalid', 'staff');

insert into public.services
  (id, tenant_id, title_json, duration_minutes, price, category, currency)
values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '{"fr":"Service fictif","en":"Fictional service","es":"Servicio ficticio"}',
   30, 5000, 'hair', 'USD');

insert into public.staff_working_hours
  (tenant_id, staff_id, weekday, start_local, end_local)
values
  ('10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000002', 1, '09:00', '17:00');

insert into public.salon_public_profiles
  (tenant_id, slug, business_name, country_code, city, postal_code,
   categories, is_published, published_at)
values
  ('10000000-0000-0000-0000-000000000001', 'route-fixture-public',
   'Route Fixture Salon', 'US', 'New York', '10001',
   array['hair'], true, clock_timestamp());

insert into private.public_booking_intent_policy
  (prepared_ttl, retention_ttl, configured_at)
values (interval '2 hours', interval '3 days', clock_timestamp());

insert into private.public_booking_quota_policy
  (action_bucket, window_seconds, ip_limit, browser_tenant_limit, intent_limit, configured_at)
values
  ('bootstrap', 600, 100, null, null, clock_timestamp()),
  ('prepare', 600, 100, 100, null, clock_timestamp()),
  ('reconcile', 600, 100, 100, null, clock_timestamp()),
  ('commit', 600, null, 100, 100, clock_timestamp()),
  ('cancel', 600, null, 100, 100, clock_timestamp()),
  ('acknowledge', 600, null, 100, 100, clock_timestamp());

set role service_role;
select public.sweep_public_booking_quota_counters(100);
select public.sweep_public_booking_intents(100);
reset role;

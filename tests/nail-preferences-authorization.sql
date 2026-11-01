-- Synthetic nail JSON only. This file runs against the migrated schema in a
-- disposable loopback PostgreSQL database, after the core client fixtures.
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
update public.clients
set nail_preferences='{"shape":"Almond","shade":"Synthetic rose A"}'::jsonb
where id='30000000-0000-0000-0000-000000000001';
select public.test_assert(
  (select count(*) from public.clients
    where id='30000000-0000-0000-0000-000000000001'
      and nail_preferences @> '{"shade":"Synthetic rose A"}'::jsonb) = 1,
  'owner reads own salon private nail preferences'
);
select public.test_rejected(
  $sql$update public.clients set nail_preferences='[]'::jsonb
    where id='30000000-0000-0000-0000-000000000001'$sql$,
  '23514'
);
select public.test_rejected(
  $sql$update public.clients set nail_preferences='"not an object"'::jsonb
    where id='30000000-0000-0000-0000-000000000001'$sql$,
  '23514'
);
select public.test_rejected(
  $sql$update public.clients set nail_preferences='null'::jsonb
    where id='30000000-0000-0000-0000-000000000001'$sql$,
  '23514'
);
select public.test_assert(
  (select count(*) from public.clients
    where id='30000000-0000-0000-0000-000000000001'
      and nail_preferences @> '{"shade":"Synthetic rose A"}'::jsonb) = 1,
  'rejected non-object nail JSON preserves prior preferences'
);

set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
update public.clients
set nail_preferences='{"shade":"Synthetic blue B"}'::jsonb
where id='30000000-0000-0000-0000-000000000002';
select public.test_assert(
  (select count(*) from public.clients
    where id='30000000-0000-0000-0000-000000000002'
      and nail_preferences @> '{"shade":"Synthetic blue B"}'::jsonb) = 1,
  'foreign salon owner reads only their own nail preferences'
);
select public.test_assert(
  (select count(*) from public.clients
    where nail_preferences @> '{"shade":"Synthetic rose A"}'::jsonb) = 0,
  'foreign salon owner cannot read another salon nail preferences'
);
do $$
declare changed integer;
begin
  update public.clients set nail_preferences='{"shade":"forbidden"}'::jsonb
  where id='30000000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  perform public.test_assert(changed = 0, 'foreign salon owner cannot change nail preferences');
end $$;

set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
select public.test_assert(
  (select count(*) from public.clients
    where nail_preferences @> '{"shade":"Synthetic rose A"}'::jsonb) = 1,
  'staff reads own salon nail preferences'
);
update public.clients
set nail_preferences=jsonb_set(nail_preferences,'{last_infill_date}','"2030-06-01"'::jsonb)
where id='30000000-0000-0000-0000-000000000001';
select public.test_assert(
  (select count(*) from public.clients
    where id='30000000-0000-0000-0000-000000000001'
      and nail_preferences @> '{"last_infill_date":"2030-06-01"}'::jsonb) = 1,
  'staff can update own salon nail preferences'
);
select public.test_assert(
  (select count(*) from public.clients
    where nail_preferences @> '{"shade":"Synthetic blue B"}'::jsonb) = 0,
  'staff cannot read foreign salon nail preferences'
);
do $$
declare changed integer;
begin
  update public.clients set nail_preferences='{"shade":"forbidden"}'::jsonb
  where id='30000000-0000-0000-0000-000000000002';
  get diagnostics changed = row_count;
  perform public.test_assert(changed = 0, 'staff cannot change foreign salon nail preferences');
end $$;

set request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
select public.test_assert(
  (select count(*) from public.clients where nail_preferences <> '{}'::jsonb) = 0,
  'authenticated nonmember cannot read private nail preferences'
);
reset role;
select public.test_assert(
  (select count(*) from public.clients
    where id='30000000-0000-0000-0000-000000000001'
      and nail_preferences @> '{"shade":"Synthetic rose A","last_infill_date":"2030-06-01"}'::jsonb) = 1,
  'cross-tenant attempts preserved salon A nail preferences'
);
select public.test_assert(
  (select count(*) from public.clients
    where id='30000000-0000-0000-0000-000000000002'
      and nail_preferences @> '{"shade":"Synthetic blue B"}'::jsonb) = 1,
  'cross-tenant attempts preserved salon B nail preferences'
);

set role anon;
select public.test_denied('select nail_preferences from public.clients');
select public.test_denied(
  $sql$update public.clients set nail_preferences='{}'::jsonb$sql$
);
reset role;

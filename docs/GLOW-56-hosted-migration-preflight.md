# GLOW-56 hosted migration preflight (draft, read-only)

This is an evidence checklist, not authority to apply SQL. Its only target is
Supabase organization `goutxcrujaxjjssbjfsn`, project
`rfwhqutkiztxkagbhevp` (`glowflow`). It does not target MowFlow or the future
`glowflow.beauty` production environment. The three GLOW-56 migrations are
committed as dormant code on GlowFlow `master`; this repository's CI/build
path does not apply them. Do not run `db push`, a migration runner, the
rollback files, a policy seed, or a mode transition based on this document.
Obtain separate approval
for the exact hosted SQL and migration-history operation after a fresh
preflight.

## Immutable source and ledger gate

The recorded source baseline is reviewed master commit
[`d27c72c4e0e695caed4dfe80792f518a93871a19`](https://github.com/mocktar2021/glowflow/commit/d27c72c4e0e695caed4dfe80792f518a93871a19).
Use an immutable reviewed GlowFlow commit, not a moving branch, as the source.
Before doing anything hosted, verify the local migration map identifies the
same organization and project and contains exactly 44 entries. Its last three
entries must be the following files in this order, with these raw SHA-256
digests (also recorded as `normalizedSha256` in the current map):

| Version | File | SHA-256 |
| --- | --- | --- |
| `20261104184112` | [private booking intents](../supabase/migrations/20261104184112_glow56_private_public_booking_intents.sql) | `fee46be8b4677f4bccc7ce74a762a7fbcd341e333be77666d4f8f19534050c03` |
| `20261104234445` | [booking quota](../supabase/migrations/20261104234445_glow56_public_booking_quota.sql) | `0941c81a76ae4b2ad4cb7b48f04121fef13fe2e5873861ddd68f66b1bd893518` |
| `20261105124804` | [booking contract gate](../supabase/migrations/20261105124804_glow56_public_booking_contract_gate.sql) | `a9f9f5238b54fa2e85da97decc0d80c201e71137bae525ee576be3190bd16c3c` |

Check the connected Supabase project metadata first. Expected: project ID/ref
`rfwhqutkiztxkagbhevp`, organization ID `goutxcrujaxjjssbjfsn`, name
`glowflow`, region `us-east-1`, status `ACTIVE_HEALTHY`. Use the project's
read-only migration-history listing, not a local file count, for the hosted
ledger: expected **41 rows**, ending at version `20261104004728`
(`queue_staff_invitation_delivery`). All three versions above must be absent.
Stop if the project, existing 41-version sequence, or local files differ.
Do not repair history by assumption. Recheck immediately before any separately
approved application and again afterward.

## Read-only catalog checks

Run only the following `SELECT` statements against the verified project.
They read PostgreSQL metadata, not customer rows. Compare every value to the
recorded 2026-11-05 baseline below; stop on any difference, including an
unexpected object already installed outside migration history.

```sql
select
  to_regnamespace('private') is not null as private_schema_present,
  to_regclass('public.tenants') is not null as tenants_present,
  to_regclass('public.appointments') is not null as appointments_present,
  to_regclass('public.salon_public_profiles') is not null as profiles_present,
  to_regclass('public.services') is not null as services_present,
  to_regprocedure('public.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)')
    is not null as legacy_booking_rpc_present,
  to_regclass('private.public_booking_intent_policy') is null as intent_policy_absent,
  to_regclass('private.public_booking_intent_cleanup_state') is null as intent_cleanup_absent,
  to_regclass('private.public_booking_browser_sessions') is null as browser_sessions_absent,
  to_regclass('private.public_booking_intents') is null as intents_absent,
  to_regclass('private.public_booking_quota_policy') is null as quota_policy_absent,
  to_regclass('private.public_booking_quota_cleanup_state') is null as quota_cleanup_absent,
  to_regclass('private.public_booking_quota_counters') is null as quota_counters_absent,
  to_regclass('private.public_booking_contract_gate') is null as contract_gate_absent;
```

Every column above must be `true`. Also list `pg_proc` in `public` and
`private` for names containing `public_booking` or named
`create_public_appointment`: only the existing
`public.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)`
and `public.get_public_booking_slots(text,uuid,date)` should exist before the
new migrations. An unexpected overload or private core is a stop condition.

```sql
select
  p.oid::regprocedure::text as signature,
  pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  pg_get_function_result(p.oid) as result_type,
  md5(pg_get_functiondef(p.oid)) as definition_md5,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
from pg_proc p
where p.oid = 'public.create_public_appointment(text,uuid,uuid,timestamptz,text,text,text,text,uuid)'::regprocedure;
```

Expected: exactly one row; owner `postgres`, `security_definer = true`,
`volatility = v`, result
`TABLE(appointment_id uuid, confirmed_start timestamp with time zone,
confirmed_end timestamp with time zone, salon_name text, service_title jsonb,
currency text, saved_locale text)`, definition MD5
`f94a559fb95e17b0ddac3d75de81ffff`, and EXECUTE grants
`false/false/true` for `anon`/`authenticated`/`service_role`. The MD5 is a
drift marker for the hosted function definition, not a source-integrity or
cryptographic approval mechanism.

The following digest query deliberately covers ordered columns and defaults,
constraints, and indexes on the six public tables the new routines use. It
does not read their rows. Keep its ordering and expression format unchanged
when comparing to the baseline.

```sql
with targets as (
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('appointments', 'markets', 'salon_public_profiles',
      'services', 'tenants', 'users')
    and c.relkind in ('r', 'p')
)
select t.relname, t.relrowsecurity as rls,
  t.relforcerowsecurity as force_rls,
  (select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s',
      a.attnum, a.attname, format_type(a.atttypid, a.atttypmod),
      a.attnotnull, a.attidentity, coalesce(pg_get_expr(d.adbin, d.adrelid), '')),
      ';' order by a.attnum), ''))
   from pg_attribute a
   left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped) as columns_md5,
  (select md5(coalesce(string_agg(con.conname || '|' || pg_get_constraintdef(con.oid),
      ';' order by con.conname), ''))
   from pg_constraint con where con.conrelid = t.oid) as constraints_md5,
  (select md5(coalesce(string_agg(pg_get_indexdef(i.indexrelid),
      ';' order by i.indexrelid::regclass::text), ''))
   from pg_index i where i.indrelid = t.oid) as indexes_md5
from targets t order by t.relname;
```

Expected exactly six rows, all `rls = true` and `force_rls = false`:

| Table | Columns MD5 | Constraints MD5 | Indexes MD5 |
| --- | --- | --- | --- |
| `appointments` | `b24d81fb4f50c2ed21aac9ff2855deed` | `2de064ba1c62dec4c36fd672fb3437db` | `4ec69b8c295c693a712b667984757ffd` |
| `markets` | `89026ba41b771190e7ae17186fc5ea25` | `4805634032e1427fbff2052fe08a8d23` | `4ac39cd1082259fd0d8b8c79218872d0` |
| `salon_public_profiles` | `3f639f059bf58cf56c14e63d57464309` | `d9efa13342b7dfca0b07be763401e5ad` | `0e9dd7ba2d9e4c3e82ffd51039f769ce` |
| `services` | `e68553115a7540fd27fc60c2ec43b66a` | `6d3920b940151070a81cc7f3c94eca71` | `07155c025c399f1f6c41eb08462d2fcb` |
| `tenants` | `d8f584aac932e74940ad0449a1792890` | `6e4d8210168754a5b4b8f4eaf75276e2` | `9a83199d9896f5a2c6a7e4356f07ea12` |
| `users` | `342a280a369e85fe7e972eb460e1b33f` | `d46326d1466d46a8208bff7bb394048e` | `8ef35a7adf4b77e05aaedd8e41c534f5` |

In particular, `appointments` must retain `UNIQUE (id, tenant_id)`, the
unique partial index on `(tenant_id, public_booking_request_key)` where the
request key is not null, and staff/station exclusion constraints. Compare
their definitions from `pg_constraint` and `pg_index`, not only their names.

```sql
select n.nspname, pg_get_userbyid(n.nspowner) as owner,
  has_schema_privilege('anon', n.oid, 'USAGE') as anon_usage,
  has_schema_privilege('authenticated', n.oid, 'USAGE') as authenticated_usage,
  has_schema_privilege('service_role', n.oid, 'USAGE') as service_role_usage
from pg_namespace n where n.nspname in ('public', 'private', 'extensions')
order by n.nspname;

select c.relname, c.relrowsecurity,
  has_table_privilege('service_role', c.oid, 'INSERT') as service_insert,
  has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
  has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('appointments', 'clients')
  and c.relkind = 'r' order by c.relname;

select e.extname, e.extversion, n.nspname as schema_name
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
where e.extname in ('postgis', 'btree_gist', 'pgcrypto', 'pg_cron', 'pg_net')
order by e.extname;
```

Expected schema USAGE for `private`: `anon = false`, `authenticated = true`,
`service_role = false` before migration 1; its owner is `postgres`. Migration
1 grants `service_role` USAGE. `appointments` and `clients` both have RLS on,
with direct INSERT `true/false/true` for
`service_role`/`anon`/`authenticated`. This is an explicitly narrow public-RPC
gate, not protection against arbitrary trusted `service_role` direct writes.
Expected installed extensions in schema `extensions`: PostGIS `3.3.7`,
`btree_gist` `1.7`, `pgcrypto` `1.3`. PostgreSQL must resolve
`pg_catalog.gen_random_uuid()` and
`pg_catalog.hashtextextended(text,bigint)`. `pg_cron` and `pg_net` are not
installed in the recorded baseline. That does not block dormant migration
application, but a monitored cleanup schedule and alert remain required
before v2 activation. Do not install either extension under this runbook.

## Strict stop and future approval boundary

Stop if any identity, ledger entry/count/order, source hash, required object,
function definition, table fingerprint, ACL, extension, or constraint differs.
Also stop if a draft object exists without the matching history, if a new
history row appears without its expected object, or if the intended migration
runner would apply any other version. Resolve drift in a separate review; do
not repair history or infer permission to apply SQL from a green code merge.

If a later owner approval names the exact SQL and matching history operation,
the only candidate order is intent `20261104184112`, quota `20261104234445`,
then contract gate `20261105124804`. Check each predecessor before advancing.
The final gate migration itself rejects existing intent, browser-session,
intent-policy, quota-policy, or quota-counter state. Installation leaves the
gate in `legacy` mode and seeds no booking policy. A future v2 transition,
Vercel setting, cookie/signing key, cleanup schedule, or live QA needs its own
review and authorization.

Rollback is not a routine reverse deployment. The
[gate rollback](../supabase/rollbacks/20261105124804_drop_public_booking_contract_gate.sql)
is guarded
for `legacy` with `ever_v2 = false` and empty intent/session/policy/counter
state. If v2 has ever opened, never restore legacy or drop its recovery fence;
use a separately reviewed recovery-only transition. Even before v2, inspect
the [quota rollback](../supabase/rollbacks/20261104234445_drop_public_booking_quota.sql)
and [intent rollback](../supabase/rollbacks/20261104184112_drop_private_public_booking_intents.sql)
conditions independently. Require separately approved aggregate evidence that
all intent, browser-session, intent-cleanup, intent-policy, quota-policy,
quota-counter, and quota-cleanup tables are empty before considering reverse
order gate, quota, intent. This independent operator stop condition applies
even if a rollback file contains its own guards; do not treat a file guard as
complete authorization. This document provides no rollback approval or
executable rollback command.

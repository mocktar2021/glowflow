# GLOW-11 production migration-ledger reconciliation

## Scope and verified target

This procedure reconciles migration metadata only. It must not execute migration SQL or change application data.

- Supabase organization: `goutxcrujaxjjssbjfsn` (`Mocktar Technologies`)
- GlowFlow project: `rfwhqutkiztxkagbhevp` (`glowflow`)
- Region: `us-east-1`
- Production application: `https://glowflow.mocktar.com`
- Audited application revision: `651196845892f816346dcde17750773e532466e2`

Never use this procedure for MowFlow or another project. Stop if the organization, project reference, project name, or region differs.

The October 14 read-only audit found 23 production ledger rows and 25 repository migration files with no matching timestamps. Twenty SQL files had the same migration names as production but different timestamps. Production also had three historical entries represented by the baseline rather than standalone files. Five later migrations were applied directly and verified in the schema but were absent from the ledger.

`supabase/migration-history-map.json` records the final repository inventory, the original filename versions, and normalized SHA-256 fingerprints. The fingerprint test prevents an already deployed SQL body from changing during or after the filename reconciliation.

## Repository alignment

The repository keeps the production timestamps as the source of truth for the 23 historical ledger entries:

- Twenty existing SQL files are renamed without changing their contents.
- `20260904204343_initial_glowflow_schema.sql` and `20260904204729_add_foreign_key_indexes.sql` are comment-only markers because `supabase/schema.sql` already supplies that historical baseline before migrations are replayed.
- `20260904234702_owner_workspace_security_invoker.sql` is a comment-only marker because the preceding checked-in workspace function already declares `SECURITY INVOKER`.

Fresh schema verification must continue to load `supabase/schema.sql` and then every migration in filename order. Do not run the baseline against an existing database.

## Production preflight

Do not start the production procedure until this repository change is merged and explicit production approval is recorded. Use a current Supabase CLI, record its version, and inspect its help before use:

```powershell
supabase --version
supabase migration repair --help
supabase db push --help
```

Link only the verified GlowFlow project when the operator environment is not already linked:

```powershell
supabase link --project-ref rfwhqutkiztxkagbhevp
supabase migration list --linked
```

The migration list must show all 28 local versions, the first 23 versions aligned with remote, and exactly these five local-only versions:

```text
20260924213044
20260925143324
20260925184222
20260925194709
20260925213000
```

Stop if any other version is missing or remote-only. Independently query the production project and retain the output in the change record:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;

select
  p.oid::regprocedure::text as identity,
  p.prosecdef as security_definer,
  has_function_privilege('public', p.oid, 'execute') as public_can_execute,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_owner_workspace';

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
```

Require the ten-argument owner-workspace function to remain `SECURITY INVOKER`, read the five explicit market columns, grant execution only to `authenticated` and trusted server roles, and contain no `SELECT *` or `markets%rowtype`. Require RLS on every public table.

The five missing versions must also retain their reviewed schema footprints before metadata repair:

- the explicit anonymous public-profile column allowlist;
- immutable `payment_entries` with RLS, validation, and mutation-rejection triggers;
- published-profile guards in both public booking functions with service-role-only execution;
- non-null appointment price snapshots and the owner-only manual-payment RPC;
- notification consent, outbox, delivery-attempt tables, RLS, immutable history, and retry functions.

## Approved metadata repair

After the preflight matches exactly, apply only the five ledger markers. This command updates migration history and does not execute the SQL files:

```powershell
supabase migration repair --linked --status applied 20260924213044 20260925143324 20260925184222 20260925194709 20260925213000
```

Do not run `supabase db push`, replay `supabase/schema.sql`, or apply any migration file during this operation.

## Post-repair verification

```powershell
supabase migration list --linked
supabase db push --linked --dry-run
```

Require all 28 local and remote versions to align and the dry run to report no pending migrations. Re-run the read-only function, RLS, grants, triggers, and schema-footprint queries. The schema fingerprints and application row counts must be unchanged because this is metadata-only. Record this database operation separately from Vercel deployment status; no application deployment is required.

## Rollback

If the repair records an unexpected version or the postcheck is not exact, remove only the five added ledger records:

```powershell
supabase migration repair --linked --status reverted 20260924213044 20260925143324 20260925184222 20260925194709 20260925213000
```

Then re-run `supabase migration list --linked`. This rollback changes migration metadata only. It must not run the checked-in SQL rollbacks because the production schema was already present before reconciliation.

## Required approval

Use this exact approval request after the repository PR and test evidence are ready:

> I approve a migration-history-only repair on Supabase organization `goutxcrujaxjjssbjfsn`, GlowFlow project `rfwhqutkiztxkagbhevp`, marking only versions `20260924213044`, `20260925143324`, `20260925184222`, `20260925194709`, and `20260925213000` as applied. Do not execute migration SQL, run `db push`, touch MowFlow, or change schema, data, Auth, or Storage. Stop if the preflight identity, 23 existing remote rows, five local-only versions, or schema fingerprints differ.

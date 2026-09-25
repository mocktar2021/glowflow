# GLOW-36 production owner-workspace repair

## Verified target

- Supabase organization: `goutxcrujaxjjssbjfsn`
- GlowFlow project: `rfwhqutkiztxkagbhevp`
- Production application: `https://glowflow.mocktar.com`
- Vercel project: `prj_YZ96jIX5QEOOI70zUlbHSaIqQbsu` in `tairoumocktar-9966s-projects`
- Application deployment: `dpl_A8YZ6tcL5dVbKH44hn1xts8GgGwL`, READY at commit `68c87822eed4a678599f2a3b2cf2430974da7891`

Production currently has `create_owner_workspace` as `SECURITY INVOKER`, but the function declares `public.markets%rowtype` and runs `select *`. The authenticated role has explicit access to operational market fields but not `created_at` or `updated_at`, so a new owner receives PostgreSQL `42501` while creating the workspace. Migration `20260924213044_fix_owner_workspace_market_permissions.sql` keeps `SECURITY INVOKER` and reads only `country_code`, `supported_locales`, `currency`, `supported_time_zones`, and `address_format`.

## Targeted application

Do not run `supabase db push`. Repository filenames and the production migration ledger use different historical timestamps. After product-owner approval, run only:

```powershell
npx supabase db query --linked --project-ref rfwhqutkiztxkagbhevp --file supabase/migrations/20260924213044_fix_owner_workspace_market_permissions.sql --output-format json
```

Record database application separately from the already READY Vercel deployment. The Management API query does not reconcile the migration ledger; ledger repair remains a separate reviewed operation.

## Verification

1. Query `pg_get_functiondef` and verify `prosecdef = false`, the five-column select, and no `select *` or `%rowtype`.
2. Verify `PUBLIC` and `anon` have no execute privilege and `authenticated` does.
3. Run `tests/production-owner-verification-run.mjs` with the exact project, URL, application origin, keys, and acknowledgement in process environment variables. It creates one randomized `@example.invalid` Auth user through the public sign-up API, confirms it, signs in through the real production form, creates the workspace through the application, renders FR/EN/ES dashboards, then deletes the tenant and Auth user in `finally`.
4. Query for the disposable owner prefix and require zero residual Auth users and tenants.

## Rollback

The migration changes one function definition and no rows. Before applying it, save the live `pg_get_functiondef` output in the change record. If verification exposes an unexpected regression, execute the checked-in copy of that pre-repair definition only:

```powershell
npx supabase db query --linked --project-ref rfwhqutkiztxkagbhevp --file supabase/rollbacks/20260924213044_restore_owner_workspace_market_select_star.sql --output-format json
```

Then re-query the function definition and privileges. This restores the previous behavior, including the known onboarding failure; it does not require data rollback.

The preferred operational response to a failed verification is to leave the corrected function in place when its definition and grants match the migration, investigate the application error, and delete the disposable fixture. Use function rollback only when the database change itself is shown to be the cause.

# GLOW-36 logical backup and restore drill

## Verified scope

`node tests/recovery-run.mjs` performs a destructive drill only against explicitly configured loopback PostgreSQL. It rejects hosted database URLs and any database name other than `postgres` for the administrative connection.

The runner creates disposable source and restore databases, applies the Supabase platform fixture plus the historical baseline and every ordered migration, and inserts synthetic tenant, user, client, service, bucket, and object-metadata records. It creates a custom-format logical backup with `pg_dump`, restores it with `pg_restore`, and verifies:

- the synthetic rows and Storage metadata;
- RLS on every public table;
- a critical tenant policy and authorization function;
- anonymous denial for client data and the intended public-profile column grants; and
- the walk-in queue's Realtime publication membership.

The runner also keeps a **separate synthetic Storage-file backup and checksum manifest** outside the database archive. After database restoration it confirms the file is absent from the restored file area, removes the source file, copies only from that separate backup, and checks that the restored bytes, size, bucket, object name, and ID match the restored database metadata and manifest. Unit tests reject a missing or tampered file, changed size/checksum, and mismatched bucket. This is a disposable local model of the two-source recovery contract, not a Supabase Storage API or historical hosted-file restore. It covers one synthetic object, not file-volume completeness or provider configuration.

Both databases and the temporary archive and synthetic files are removed after success or failure. The ordinary unit suite also tests that the runner fails closed for remote hosts, unexpected database names, and URL options.

Run it locally with PostgreSQL client tools matching the target server where possible:

```powershell
$env:GLOWFLOW_RLS_ADMIN_DATABASE_URL = 'postgresql://postgres:<local-password>@127.0.0.1:55439/postgres'
$env:PSQL_BIN = 'C:\Program Files\PostgreSQL\14\bin\psql.exe'
node tests/recovery-run.mjs
```

The database-security workflow runs the same drill on PostgreSQL 16. When GitHub Actions minutes are unavailable, retain the local command output and record the PostgreSQL and client versions used. A green result is not the historical database-plus-Storage exercise required for public paid launch; that remains a separate owner-reviewed gate.

## Hosted recovery runbook

1. Confirm the incident lead, database owner, support contact, recovery point objective, and recovery time objective.
2. Select the last known-good hosted backup and record its timestamp. Preserve the migration-history table separately.
3. Restore into an isolated Supabase project first. Never test a restore over production.
4. Restore any custom Auth or Storage objects required by the project, reactivate Realtime publication membership, and reset custom role passwords where applicable.
5. Restore Storage file objects from the separate object backup. A database backup contains Storage metadata but not the file contents.
6. Compare critical table counts and checksums, run authorization tests, then verify sign-in, dashboard, discovery, booking, payment webhook idempotency, and all three locales.
7. Record elapsed time, the achieved recovery point, failures, owners, and go/no-go decision. Keep the original production project unchanged until the restored environment passes review.

Supabase documents that database backups exclude Storage objects, that restore operations incur downtime, and that logical CLI restores need separate handling for migration history, custom roles, Auth/Storage objects, and Realtime publications. See [Database Backups](https://supabase.com/docs/guides/platform/backups) and [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

### Guarded hosted checks

`tests/hosted-recovery-compare.mjs` performs GET-only count comparisons between production and an isolated **current-state clone**. It requires exact, different project refs and URLs plus `GLOWFLOW_RECOVERY_COMPARISON_SCOPE=current-state-clone-only` before it will run. It compares a fixed 16-table subset, **all pages** of Auth users, selected Storage bucket settings (ID, name, public access, size limit, allowed MIME types), and representative anonymous access denials. It never prints credentials or row contents. Its service-role credentials are privileged even though this script only reads: use a one-off, access-controlled process. A count match does not prove row-level equality or a historical recovery point.

`tests/hosted-storage-recovery-run.mjs` writes only to the explicitly named recovery project. It uploads a synthetic image, downloads and checksums the backup, deletes the object metadata, restores the file, verifies its checksum, and removes the synthetic object. The URL guard rejects production, mismatched project refs, URL paths, query strings, and insecure origins.

`tests/hosted-recovered-app-run.mjs` creates a disposable confirmed owner only in the explicitly named recovery project, starts GlowFlow locally against that project, signs in through the real browser form, and verifies the owner dashboard and navigation in EN, FR and ES. Its `finally` cleanup removes the temporary tenant and Auth user and stops the server and browser.

Provide credentials only through process environment variables and remove them from the process after the run:

```powershell
$env:GLOWFLOW_PRODUCTION_PROJECT_REF = '<production-ref>'
$env:GLOWFLOW_PRODUCTION_SUPABASE_URL = 'https://<production-ref>.supabase.co'
$env:GLOWFLOW_PRODUCTION_SERVICE_ROLE_KEY = '<read-only comparison credential>'
$env:GLOWFLOW_RECOVERY_PROJECT_REF = '<temporary-recovery-ref>'
$env:GLOWFLOW_RECOVERY_SUPABASE_URL = 'https://<temporary-recovery-ref>.supabase.co'
$env:GLOWFLOW_RECOVERY_SERVICE_ROLE_KEY = '<temporary recovery credential>'
$env:GLOWFLOW_RECOVERY_ANON_KEY = '<temporary recovery publishable key>'
$env:GLOWFLOW_RECOVERY_PUBLISHABLE_KEY = '<temporary recovery publishable key>'
$env:GLOWFLOW_RECOVERY_COMPARISON_SCOPE = 'current-state-clone-only'
node tests/hosted-recovery-compare.mjs
node tests/hosted-storage-recovery-run.mjs
node tests/hosted-recovered-app-run.mjs
```

On September 24, 2026, a non-persistent Supabase `micro` preview branch cloned the production project's current data and was first observed healthy after 3 minutes 35 seconds. Sixteen application-table counts, Auth user counts, and Storage bucket definitions matched. Anonymous client and Stripe-connection access remained denied, as did private public-profile metadata. The Storage drill restored a 4,164-byte synthetic PNG with an identical SHA-256 checksum and cleaned it up. The temporary branch was deleted after verification, and production received no writes.

## Historical September 24 recovery evidence and current gate

The local drill proves the checked-in schema and synthetic database records can survive a logical backup and restore. The September 24 hosted drill proved a current-state data-bearing clone, aggregate production-data parity, Auth/bucket parity, representative anonymous denials, and a synthetic Storage file recovery. At that stage, a selected historical daily/PITR point, real file-volume recovery, provider settings, secrets, and a complete signed-in application journey remained unverified; the subsequent exercise closed only the application-journey gap for that temporary recovery project. Working targets are a 24-hour RPO with daily backups and a 4-hour RTO; the product owner is the incident lead, Mocktar Technologies owns the database, and `glowflow@mocktar.com` is the support contact. These historical results do not establish a current release recovery point or achieved RPO/RTO.

The recovered-app run subsequently verified confirmed-owner password authentication, workspace creation, and owner dashboards in EN, FR and ES. It exposed a `42501` onboarding failure caused by the workspace function reading more `markets` columns than the authenticated grant allows. Migration `20260924213044_fix_owner_workspace_market_permissions.sql` keeps the function `SECURITY INVOKER` and narrows its query to granted fields. The journey passed after applying the candidate migration only to the temporary recovery project; cleanup removed the user and tenant, and the project was deleted. This paragraph records the September 24 candidate test, not the current hosted migration state.

The final local validation passed the production build, 125 ordinary tests with 2 expected opt-in database skips, and both database suites separately against disposable PostgreSQL 14. The fresh-schema suite applied the baseline plus every migration, including the owner-workspace fix, and passed the full authorization matrix. The sandbox transaction/RLS suite also passed.

The old proposal to apply `20260924213044_fix_owner_workspace_market_permissions.sql` and then repair its migration history is **superseded; do not execute it**. A read-only 2026-11-05 check identified GlowFlow organization `goutxcrujaxjjssbjfsn`, project `rfwhqutkiztxkagbhevp`, and 41 hosted migration rows through `20261104004728`; the hosted ledger already includes version `20260924213044`. This ledger check does not by itself prove current schema equivalence or a successful historical restore. For any new hosted change, first verify the exact project, ledger, and schema against the intended release, obtain separate approval for the exact operation, and use the migration-specific preflight in `docs/GLOW-56-hosted-migration-preflight.md` where applicable. Do not use an unrestricted `supabase db push` to replay unrelated migrations.

### Historical-point acceptance remains separate

Do **not** run the current-state comparison against a selected older backup and interpret mismatched live counts as restore failure, or matching counts as historical proof. Production can change after the chosen recovery timestamp. Before a historical drill, record the exact backup timestamp, expected source snapshot or manifest from that timestamp, separate Storage-file backup source, Auth and provider configuration inventory, and authorized recovery project. Restore only into that isolated project, compare against the recorded historical manifest (including file checksums, not just bucket metadata), and measure achieved RPO/RTO. The existing 16-table comparator is not that historical-manifest verifier. Keep the GLOW-36 launch gate open until the owner reviews actual hosted historical-point evidence and the recovery project is safely retired.

For a separately authorized historical drill, `node ops/historical-restore-evidence.mjs <historical-source.json> <isolated-restore.json>` compares two **locally supplied, aggregate-only** manifests scoped to GlowFlow source project `rfwhqutkiztxkagbhevp`. The source manifest must be recorded from the selected historical backup point, not from today's production state. Both manifests must include the exact source project ref and recovery point; the restored manifest must additionally name the distinct isolated project and UTC observation time. Each snapshot requires counts for the 16 baseline tables plus any additional tables in that release, the Auth user count, bucket definitions (`id`, `public`, `fileSizeLimit`, `allowedMimeTypes`), and a complete separate Storage-file inventory (`id`, `bucketId`, `name`, byte `size`, lowercase SHA-256). An object missing on one side, extra, duplicated, or changed fails the comparison. Do not put these manifests in Git, logs, tickets, or artifacts if object names can identify a customer. Keep them in an approved, access-controlled evidence location.

The validator has no Supabase connection or credentials and cannot prove when or how either manifest was captured, that the file inventory truly covers the entire bucket, or that a historical restore happened. An operator must independently establish backup provenance and file-volume completeness, check authorization and the signed-in journey on the isolated project, measure RPO/RTO, and record a reviewed go/no-go decision. A green local comparison alone does not close GLOW-36 or authorize a production restore.

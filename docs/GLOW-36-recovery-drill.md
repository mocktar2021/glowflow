# GLOW-36 logical backup and restore drill

## Verified scope

`node tests/recovery-run.mjs` performs a destructive drill only against explicitly configured loopback PostgreSQL. It rejects hosted database URLs and any database name other than `postgres` for the administrative connection.

The runner creates disposable source and restore databases, applies the Supabase platform fixture plus the historical baseline and every ordered migration, and inserts synthetic tenant, user, client, service, bucket, and object-metadata records. It creates a custom-format logical backup with `pg_dump`, restores it with `pg_restore`, and verifies:

- the synthetic rows and Storage metadata;
- RLS on every public table;
- a critical tenant policy and authorization function;
- anonymous denial for client data and the intended public-profile column grants; and
- the walk-in queue's Realtime publication membership.

Both databases and the temporary archive are removed after success or failure. The ordinary unit suite tests that the runner fails closed for remote hosts, unexpected database names, and URL options.

Run it locally with PostgreSQL client tools matching the target server where possible:

```powershell
$env:GLOWFLOW_RLS_ADMIN_DATABASE_URL = 'postgresql://postgres:<local-password>@127.0.0.1:55439/postgres'
$env:PSQL_BIN = 'C:\Program Files\PostgreSQL\14\bin\psql.exe'
node tests/recovery-run.mjs
```

The database-security workflow runs the same drill on PostgreSQL 16. When GitHub Actions minutes are unavailable, retain the local command output and record the PostgreSQL and client versions used.

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

`tests/hosted-recovery-compare.mjs` performs read-only count comparisons between production and an isolated recovery project. It requires exact, different project refs and URLs before it will run. It compares all 16 application tables, Auth user counts, Storage bucket definitions, and representative anonymous access denials. It never prints credentials or row contents.

`tests/hosted-storage-recovery-run.mjs` writes only to the explicitly named recovery project. It uploads a synthetic image, downloads and checksums the backup, deletes the object metadata, restores the file, verifies its checksum, and removes the synthetic object. The URL guard rejects production, mismatched project refs, URL paths, query strings, and insecure origins.

Provide credentials only through process environment variables and remove them from the process after the run:

```powershell
$env:GLOWFLOW_PRODUCTION_PROJECT_REF = '<production-ref>'
$env:GLOWFLOW_PRODUCTION_SUPABASE_URL = 'https://<production-ref>.supabase.co'
$env:GLOWFLOW_PRODUCTION_SERVICE_ROLE_KEY = '<read-only comparison credential>'
$env:GLOWFLOW_RECOVERY_PROJECT_REF = '<temporary-recovery-ref>'
$env:GLOWFLOW_RECOVERY_SUPABASE_URL = 'https://<temporary-recovery-ref>.supabase.co'
$env:GLOWFLOW_RECOVERY_SERVICE_ROLE_KEY = '<temporary recovery credential>'
$env:GLOWFLOW_RECOVERY_ANON_KEY = '<temporary recovery publishable key>'
node tests/hosted-recovery-compare.mjs
node tests/hosted-storage-recovery-run.mjs
```

On September 24, 2026, a non-persistent Supabase `micro` preview branch cloned the production project's current data and was first observed healthy after 3 minutes 35 seconds. Sixteen application-table counts, Auth user counts, and Storage bucket definitions matched. Anonymous client and Stripe-connection access remained denied, as did private public-profile metadata. The Storage drill restored a 4,164-byte synthetic PNG with an identical SHA-256 checksum and cleaned it up. The temporary branch was deleted after verification, and production received no writes.

## Remaining production gate

The local drill proves the checked-in schema and synthetic database records can survive a logical backup and restore. The hosted drill proves a current-state data-bearing clone, aggregate production-data parity, Auth/bucket parity, representative anonymous denials, and a synthetic Storage file recovery. It does not prove restoration to a selected historical daily/PITR point, real file-volume recovery, provider settings, secrets, or a complete signed-in application journey against recovered infrastructure. Working targets are a 24-hour RPO with daily backups and a 4-hour RTO; the product owner is the incident lead, Mocktar Technologies owns the database, and `support@mocktar.com` is the support contact.

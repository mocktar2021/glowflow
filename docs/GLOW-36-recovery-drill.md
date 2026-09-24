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

## Remaining production gate

This drill proves the checked-in schema and synthetic database records can survive a logical backup and restore. It does not prove a hosted Supabase backup, real production row volume, Storage file recovery, provider settings, secrets, recovery timing, or operational ownership. GLOW-36 remains incomplete until an isolated hosted restore is exercised and the legal, support, incident-contact, and launch-checklist acceptance criteria are approved.

# GLOW-56 inactive Cron operator artifact, not an activation

`ops/glow56-stage-inactive-cron.psql` and
`ops/glow56-unstage-inactive-cron.psql` are deliberately **outside**
`supabase/migrations/`. The ordinary PostgreSQL 16 migration-replay jobs
cannot install `pg_cron`, which is cluster/database specific. The dedicated
disposable Supabase PostgreSQL 17 job executes these exact files after its
real application migration replay. A merge does not run either file on hosted
GlowFlow, install an extension, create a hosted job, send a ping, or enable v2.

The stage file inserts only three `active=false` jobs, in one transaction,
under the non-superuser `postgres` role. It rejects a wrong PostgreSQL or
`pg_cron` version, missing target database, broad direct `cron.job` DML,
missing execution permission, a same-name job, missing local cleanup
functions, or an unexpected postcondition. The exact commands are two
bounded cleanup RPCs every minute and a **readiness-only** predicate twice
per hour. The last command does not alert anyone. An independent alert path
and its actual delivery to both responders remain hard gates for the public
paid launch at `glowflow.beauty`.

The unstage file refuses to touch active, changed, missing, or additional
same-name jobs. It checks all three exact names, commands, schedules,
database, and username before unscheduling their IDs. It never drops the
extension or deletes run history. The acknowledgement variable in both files
is only a deliberate-use guard, **not** project identity or authorization.

Before a separately approved hosted use, the operator must record fresh
read-only evidence for all of these, stopping on any difference:

1. Connected organization `goutxcrujaxjjssbjfsn` and project
   `rfwhqutkiztxkagbhevp`, not MowFlow or future production; project health,
   PostgreSQL version, intended database, and current GitHub/Vercel revision.
2. Every remote migration version/name and its source fingerprint, including
   the two versions local-only on November 9,
   `20261108003618` and `20261109162926`. The latter must be applied under
   its **own** approval before staging. Never use bulk `db push` or mark a
   missing migration applied without its actual SQL.
3. `pg_cron` 1.6.4 installed in `pg_catalog` under its **own** approved step;
   native restricted Cron ACLs, the actual execution role, the three cleanup
   function definitions/owners/permissions, private RLS/grants, and existing
   `cron.job` rows for **all** owners. The stage script cannot independently
   prove the Supabase project ID or inspect functions in a different target
   database, so external preflight is mandatory.
4. Booking gate and policy state, cleanup backlog and full-sweep heartbeats,
   extension usage, provisioned disk/compute, run-history retention, and
   verified no-new-payment headroom. The repository's successful empty-run
   fixture is not a realistic throughput or cost guarantee.
5. A reviewed alert design that cannot expose a Healthchecks bearer URL via
   `pg_net` queue tables, Cron metadata, logs, or redirects. No URL is in
   these files. The current readiness-only job does **not** satisfy alert
   delivery, acknowledgement, or missed-run coverage.

After a separately approved inactive stage, inspect all three returned IDs,
names, commands, schedules, target database, username, `active=false`, and
run details. Wait across a scheduled interval and verify no run for those
IDs. Stop and follow the exact scoped disable plan if any job ran or differs.
Neither the stage nor the unstage file is an authorization to execute hosted
SQL. A later **active** rollout requires another approval, observed alert
delivery to primary and backup, bounded backlog drain, and a staffed rollback
window while booking v2 remains off.

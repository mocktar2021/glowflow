# GLOW-56 contract-gate hosted smoke plan

Status: proposal only. This file changes no hosted state and does not authorize
the migration, a booking write, rollback, v2 activation, or a deployment. The
GlowFlow QA domain shares this hosted database; generic Vercel Preview is not
an isolated test target. Do not run `db push`.

## Exact scope and present baseline

- Supabase organization `goutxcrujaxjjssbjfsn`, project
  `rfwhqutkiztxkagbhevp` (`glowflow`, `us-east-1`, `ACTIVE_HEALTHY`). Never
  target MowFlow or the future `glowflow.beauty` production environment.
- The only candidate forward file is
  `supabase/migrations/20261105124804_glow56_public_booking_contract_gate.sql`,
  SHA-256 `dd3ae969ddb7fe39931aa53813045c95fd85650ab1b0764899913b8967aa3a73`,
  from immutable reviewed GlowFlow source `b5de72bf7599e45b587670faf4a4df2e38d5d06f`.
  It must receive exactly migration-history version `20261105124804` and name
  `glow56_public_booking_contract_gate`.
- The last observed hosted ledger has exactly 43 rows, ending in
  `20261104184112_glow56_private_public_booking_intents` and
  `20261104234445_glow56_public_booking_quota`. The final gate and later
  GLOW-27 `20261108003618` are absent. Recheck all 43 versions and names
  against the immutable map immediately before any approved application.
- All seven predecessor intent/session/policy/quota/cleanup tables had zero
  rows, the gate table was absent, and the legacy booking RPC definition MD5
  was `f94a559fb95e17b0ddac3d75de81ffff` at the November 7 check.
  Recheck those values, the six public table fingerprints, ACL/RLS, required
  constraints/extensions, source hash, and advisors. Stop on any difference.

## Proposed hosted operation, requiring separate exact approval

1. Confirm the project identity and current 43-row ledger. Query aggregate
   counts only for all seven predecessor tables; each must be zero. The
   runbook's cleanup-heartbeat check covers both cleanup tables. Verify the
   legacy RPC fingerprint and absence of the gate. Stop on any drift.
2. Apply the exact one gate SQL body once through a single-migration tool.
   Do not select the later GLOW-27 file or reapply the predecessors. Supabase
   `apply_migration` may assign a generated history version. If so, first
   require exactly one new row with the expected gate name, then normalize
   *only that row's metadata* to `20261105124804` in a guarded transaction.
   Stop rather than repeat SQL if the result or ledger is ambiguous.
3. Require exactly 44 ledger rows and no generated alias. The gate must have
   one row with `mode = 'legacy'` and `ever_v2 = false`; the original booking
   implementation must exist as an unexposed private core, with a service-role
   only public wrapper. No intent or quota policy, schedule, Vercel flag, or
   v2 mode may be enabled. Inspect RLS/grants, unchanged public table
   fingerprints, security advisors, and recent Vercel booking-route errors.
4. For the separately approved booking-write smoke, recheck that the clearly
   labeled `Mocktar Braiding` **Test** service is active and publicly bookable.
   Choose one currently available future slot and its staff ID immediately
   before testing; stop if that fixture or slot differs. Use a fresh unique
   request UUID and synthetic `@example.invalid` email. Under `service_role`,
   call the legacy public booking RPC **once inside an explicit database
   transaction that ends in `ROLLBACK`**. Set short local lock, statement, and
   idle-in-transaction timeouts so an error or lost client cannot leave a
   write transaction open. Require a valid confirmation from the wrapper,
   then verify the synthetic request key, email, and appointment ID have no
   persisted rows.
   This is a transient write to the shared QA database, not a public HTTP POST.
   The appointment trigger was observed to return before scheduling when the
   synthetic client lacks email consent. Recheck its definition before use;
   stop if it or any outbound side-effect path has changed. Never use a real
   customer contact, payment method, or send a notification.
5. Recheck the gate remains `legacy`, `ever_v2 = false`, all seven predecessor
   tables remain empty, the 44-row ledger is exact, and the recent Vercel
   booking-route error count has not risen. Record the synthetic marker and
   confirmation only in restricted operator evidence, never public logs.

The transaction-only smoke is an explicit exception to the older no-live-write
QA rule and **must be approved as such before execution**. It does not prove
v2 booking or browser recovery, and it does not permit v2 activation.

## Failure and rollback boundary

If migration or smoke results are ambiguous, stop. Confirm that the test
transaction ended or was aborted before any further operation. Do not retry
the booking with a new key, enable v2, or run a bulk migration. The guarded file
`supabase/rollbacks/20261105124804_drop_public_booking_contract_gate.sql`
(SHA-256 `d0a9d7df5b0c4cac68756da8f4c2f8ee391ce2389142a6db2ae7f14ed68d5bec`)
is a *candidate*, not an automatic response. Before separately approved
rollback, require the gate to be `legacy` with `ever_v2 = false`, all seven
predecessor tables empty, the exact rollback source verified, and the 44-row
history reconciled. Roll back only the gate, not the already applied intent
or quota migrations, unless those are separately reviewed and approved. If
v2 has ever opened, never use the legacy rollback; retain recovery-only mode.

GLOW-56 stays In Progress until the hosted behavior and owner acceptance
journey are verified. The post-migration information-only advisor findings
for seven private RLS tables without policies and two unindexed intent-table
foreign keys should be reviewed before v2 activation; do not add grants or
indexes as an unreviewed side effect of this gate rollout.

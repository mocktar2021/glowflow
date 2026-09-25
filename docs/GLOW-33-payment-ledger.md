# GLOW-33 immutable payment ledger

GlowFlow now has an append-only source of truth for appointment payments and refunds. Each entry stores a positive amount in minor currency units; `entry_type` determines whether it adds to or subtracts from the appointment balance. Cash, connected-account Stripe charges, and card-terminal payments are recorded independently, so mixed tender is represented by multiple entries rather than a mutable total.

Only a salon owner may insert a manual cash or external-card entry, and manual entries cannot carry provider identifiers. Staff can read their tenant ledger but cannot insert, update, or delete entries. Anonymous, unaffiliated, and cross-tenant access is denied. Provider code can insert Stripe entries through the service role after it has independently verified a signed webhook; the provider account must match the tenant's connected account. Provider references and tenant idempotency keys prevent duplicate entries. Concurrent refunds serialize on the appointment and cannot exceed recorded payments. Currency must match the tenant currency.

The migration does not modify the existing owner-only Stripe sandbox, create live charges, issue receipts, or infer cancellation/refund/tax rules. These product and operations decisions remain required:

- which staff roles may record cash or external-card tender;
- the cancellation deadline, refundable percentage, and no-show policy;
- required receipt numbering, legal identity, and tax fields for each market;
- the exact provider event mapping for live connected-account charges and refunds.

Payment entries restrict deletion of tenants, appointments, and actor user records once those
records are referenced. Account closure and retention procedures must preserve or archive the
financial audit history before any future anonymization workflow is approved.

Production application requires a separately reviewed targeted migration. Do not run an unrestricted `supabase db push` while the remote migration ledger differs from repository filenames.

## Production target and application

- Supabase organization: `goutxcrujaxjjssbjfsn`
- GlowFlow project: `rfwhqutkiztxkagbhevp`
- Migration: `supabase/migrations/20260925143324_add_immutable_payment_ledger.sql`

Before applying the migration, independently confirm that the linked project reference is
`rfwhqutkiztxkagbhevp`. Never run this migration against MowFlow or use a blanket migration
push. After product-owner approval, apply only the reviewed file:

```powershell
npx supabase db query --linked --project-ref rfwhqutkiztxkagbhevp --file supabase/migrations/20260925143324_add_immutable_payment_ledger.sql --output-format json
```

Record this database operation separately from the Vercel application deployment. The
Management API query does not add the repository timestamp to the remote migration ledger;
ledger reconciliation remains a separate reviewed operation.

## Production verification

Run read-only checks immediately after application and retain their output in the change
record:

1. Confirm `payment_entries` exists with row-level security enabled and forced RLS disabled.
2. Confirm `anon` has no table privileges; `authenticated` and `service_role` have only
   `SELECT` and `INSERT`.
3. Confirm the tenant-member select and owner-only insert policies are present with the
   expected roles and expressions.
4. Confirm both trigger functions are `SECURITY INVOKER`, have an empty search path, and are
   not executable by `PUBLIC`, `anon`, or `authenticated`.
5. Confirm the provider-reference and tenant-idempotency unique constraints exist.
6. In a transaction that is rolled back, create disposable tenant, owner, staff, unrelated
   user, and appointment fixtures. Re-run the repository authorization assertions covering
   owner insert, staff read, staff insert denial, cross-tenant denial, duplicate idempotency,
   currency mismatch, update/delete rejection, valid refund, excess refund, and concurrent
   refund serialization.
7. Require zero persistent fixture rows after the transaction and record the count.

## Rollback

The rollback file is intentionally guarded. It aborts if `payment_entries` contains any row,
because payment and refund history must never be discarded to roll back an application
release. If first-deployment verification fails and the table is still empty, execute:

```powershell
npx supabase db query --linked --project-ref rfwhqutkiztxkagbhevp --file supabase/rollbacks/20260925143324_drop_empty_payment_ledger.sql --output-format json
```

Then verify that `payment_entries`, `get_appointment_payment_summary`, and the two private
trigger functions are absent. If any ledger row exists, keep the schema in place and roll the
application back independently; design a forward-compatible repair and preserve the audit
history.

Both the forward migration and guarded rollback use an explicit transaction so an error cannot
leave a partially created or partially removed ledger schema.

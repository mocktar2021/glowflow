# GLOW-29 messaging persistence

GlowFlow now has provider-neutral persistence for notification consent, scheduling, and delivery history. The schema does not send email or SMS and no delivery worker, provider credential, webhook, or customer communication is enabled.

Consent is an append-only stream of explicit `consented` and `opted_out` events for each client and channel. No event means consent is unknown, which blocks delivery claims. The immutable outbox derives appointment and tenant identity from stored records. Confirmation and future 24-hour and 2-hour reminder entries are idempotent for the same request and appointment-start snapshot. A reschedule appends a new revision; the old revision remains auditable and becomes ineligible. A different request key for the same snapshot is rejected instead of silently accepting mismatched input. Append-only attempt events record claims and final outcomes. Expired claims and explicit `retryable` outcomes can become eligible again; the caller supplies the next retry time because no retry cadence has been approved.

Authenticated tenant members can read their tenant's records. Anonymous and unrelated users cannot read them. Only the service role can execute the consent, scheduling, claim, and result functions. Application code currently gives owners a read-only status view and a fictitious template preview. It does not expose a consent editor or a send control.

## Production target and application

- Supabase organization: `goutxcrujaxjjssbjfsn`
- GlowFlow project: `rfwhqutkiztxkagbhevp`
- Migration: `supabase/migrations/20260925213000_add_notification_persistence.sql`

Before any production operation, independently confirm the linked project reference is exactly `rfwhqutkiztxkagbhevp`. Never apply this migration to MowFlow. Apply only the reviewed file after separate product-owner approval; do not run a blanket `supabase db push` or reconcile unrelated migration timestamps.

```powershell
npx supabase db query --linked --project-ref rfwhqutkiztxkagbhevp --file supabase/migrations/20260925213000_add_notification_persistence.sql --output-format json
```

Record the database application separately from the Vercel deployment. A direct Management API query does not add this repository timestamp to the remote migration ledger.

## Verification

Immediately after application, use read-only queries and disposable transaction-scoped fixtures to verify:

1. All three tables exist with RLS enabled.
2. `anon` has no table privileges; `authenticated` and `service_role` have read-only table privileges.
3. Tenant members can read only their tenant; anonymous and unrelated identities see no rows.
4. Mutating functions are executable only by `service_role`, use `SECURITY DEFINER`, and have an empty search path.
5. Consent, scheduling, claim, and result request keys are idempotent and mismatched replays fail. Rescheduling appends a current schedule revision and makes the prior snapshot ineligible.
6. Missing consent and opt-out block claims; consent permits a due claim.
7. Duplicate/concurrent claims serialize; stale results fail; retry eligibility honors the stored `retry_after`; terminal results cannot be reclaimed.
8. Direct update or deletion of consent, outbox, and attempt history fails.
9. The application labels delivery as disabled and never makes a provider request.
10. All disposable fixtures are rolled back and the retained-row count is zero.

## Rollback

The rollback refuses to run once any consent, outbox, or delivery-attempt row exists. If first-deployment verification fails while all three tables are still empty, execute only:

```powershell
npx supabase db query --linked --project-ref rfwhqutkiztxkagbhevp --file supabase/rollbacks/20260925213000_drop_empty_notification_persistence.sql --output-format json
```

Then verify that the three tables and all public/private workflow functions are absent. If any history exists, keep the schema in place, roll back the application independently, and use a forward repair that preserves the audit trail.

Provider selection, customer-facing consent capture, message contents beyond the current preview, retry cadence and maximum attempts, operational alert routing, delivery support ownership, and messaging allowances remain product and operations decisions. They must be approved before a sender is implemented or enabled.

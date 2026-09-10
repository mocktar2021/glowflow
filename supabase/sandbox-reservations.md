# Sandbox reservation migration

`20260910232219_add_stripe_sandbox_reservations.sql` creates isolated sandbox reservation and event tables. It never writes live clients, appointments, invoices, or payment destinations. No backfill is required. Keep the feature flag off until migration and preview verification are complete. Only server-side service-role calls may mutate the sandbox state; owners may read their own reservations.

Sandbox resource exclusion protects other sandbox holds, including sanitation buffers. Live availability is checked at reservation and verified payment success. Sandbox reservations do not block the real calendar; these are simulations and must never be described as real confirmed appointments. A late payment or lost live capacity requires reconciliation, without automatic refund or appointment creation.

The test runner requires an explicitly supplied **fresh localhost database** named `glowflow_sandbox_test` (optionally followed by digits/underscores). It refuses non-local or nonempty targets. Set `GLOWFLOW_SANDBOX_TEST_DATABASE_URL` and, if needed, `PSQL_BIN`, then run `node --test tests/sandbox-database.test.mjs`. Without the opt-in environment variable it is skipped. The fixture models required preexisting objects and executes the existing availability function plus the real new migration. It is not a full historical migration replay: the repository's existing `supabase/schema.sql` contains malformed/duplicated definitions. Local PostgreSQL 14 execution passed on 2026-09-10, including concurrent resource requests and webhook deliveries.

Before activation, rollback in this order:

```sql
DROP FUNCTION public.process_stripe_sandbox_event(text,text,uuid,text,text,text,integer,text,uuid,uuid,uuid,boolean);
DROP FUNCTION public.attach_stripe_sandbox_checkout(uuid,text,text);
DROP FUNCTION public.reserve_stripe_sandbox_booking(text,uuid,uuid,timestamptz,text,text,text,text,uuid);
DROP TABLE public.stripe_sandbox_events;
DROP TABLE public.stripe_sandbox_reservations;
```

After activation, disable the feature first and preserve these tables for reconciliation; do not discard payment correlation or receipt history. No remote migration or Supabase advisor run was performed by this change.

# GLOW-33 trusted payment recording runbook

This change snapshots each appointment's service title, duration, price, deposit, and currency. Owners can then record cash or externally processed card payments through one idempotent database function. The ledger remains append-only, and every payment is serialized against its appointment and limited to the captured total.

## Targeted application

- Confirm the Supabase organization is `goutxcrujaxjjssbjfsn` and the project reference is `rfwhqutkiztxkagbhevp`.
- Apply only `supabase/migrations/20260925194709_add_trusted_appointment_payment_recording.sql` after the payment-ledger and publication-guard migrations are present.
- Do not use `supabase db push` or replay historical migrations.
- Record this database operation separately from the Vercel deployment.

## Preflight

Run these read-only checks on `rfwhqutkiztxkagbhevp`. Stop if the project reference differs, a service join is missing, a ledger uses a currency other than the service that will be snapshotted, or an existing net payment exceeds the price that will be snapshotted.

```sql
select count(*) as appointments_without_service
from public.appointments as appointment
left join public.services as service
  on service.id = appointment.service_id and service.tenant_id = appointment.tenant_id
where service.id is null;

with ledger as (
  select tenant_id, appointment_id,
    sum(case when entry_type='payment' then amount else -amount end) as net_paid,
    count(distinct currency) as currency_count,
    min(currency) as ledger_currency
  from public.payment_entries
  group by tenant_id, appointment_id
)
select appointment.id, service.price, service.currency,
  ledger.net_paid, ledger.ledger_currency, ledger.currency_count
from ledger
join public.appointments as appointment
  on appointment.id=ledger.appointment_id and appointment.tenant_id=ledger.tenant_id
join public.services as service
  on service.id=appointment.service_id and service.tenant_id=appointment.tenant_id
where ledger.net_paid > service.price
   or ledger.currency_count <> 1
   or ledger.ledger_currency <> service.currency;
```

The first query must return `0`; the second must return no rows. Preserve the output with the database change record. These checks detect unsafe conflicts but cannot reconstruct a historical booking price that was never stored. If the results need interpretation, do not guess or mutate financial history; pause the migration and prepare a reviewed data repair.

After approval, apply only the reviewed file:

```powershell
npx supabase db query --linked --project-ref rfwhqutkiztxkagbhevp --file supabase/migrations/20260925194709_add_trusted_appointment_payment_recording.sql --output-format json
```

## Verification

1. Confirm the four `service_*` snapshot columns on `appointments` are non-null and their constraints are validated.
2. Confirm existing appointments match the linked service at migration time.
3. Create a disposable appointment, change its catalog service, and verify its captured title, duration, price, deposit, and currency do not change.
4. As its owner, record cash and external-card entries and verify the same request key returns the same entry.
5. Verify a payment above the outstanding amount fails with `payment_exceeds_outstanding_balance` and leaves the ledger unchanged.
6. Verify staff, unrelated users, anonymous users, and cross-tenant appointment identifiers cannot record a payment.
7. Submit concurrent payments whose sum exceeds the outstanding amount and verify at most the bounded amount commits.
8. Insert more than 1,000 disposable ledger entries for one appointment and verify `get_appointment_payment_summaries` returns the complete grouped total in one row.
9. Remove every disposable fixture and confirm no test rows remain.

Retain these read-only catalog checks as post-application evidence:

```sql
select column_name, is_nullable
from information_schema.columns
where table_schema='public' and table_name='appointments'
  and column_name in ('service_title_json','service_price','service_deposit_amount','service_currency')
order by column_name;

select p.prosecdef, p.proconfig,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='record_manual_appointment_payment';

select p.proname, p.prosecdef, p.proconfig,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='get_appointment_payment_summaries';

select count(*) as snapshot_mismatch
from public.appointments
where service_price < 0
   or service_deposit_amount not between 0 and service_price
   or service_currency !~ '^[A-Z]{3}$'
   or jsonb_typeof(service_title_json) <> 'object';
```

Expect all four columns to report `NO`, `prosecdef=false`, an empty `search_path` in `proconfig`, anonymous execute to be false, authenticated execute to be true, and `snapshot_mismatch=0`.

## Rollback

Roll the application back to the preceding deployment first. Keep the additive snapshot columns and stricter ledger validation in place: removing either can discard the historical price basis or permit an overpayment. Revoke the new entry point if it must be disabled immediately:

```sql
begin;
revoke all on function public.record_manual_appointment_payment(uuid, text, integer, uuid)
from public, anon, authenticated;
commit;
```

That rollback stops new manual recording without changing any payment row. Restore access only through a reviewed forward migration. If verification fails before any appointment or ledger row exists, the new function and four columns can be removed in a separately reviewed migration after restoring the preceding trigger functions. Never drop snapshot columns or ledger objects when they contain business history.

The appointment trigger and stricter payment validator are intentionally retained during an application rollback. They are backward compatible with the preceding application and protect already captured commercial history. If either function is defective, ship a reviewed forward repair that preserves every snapshot and ledger row; do not restore the older validator, which permits payments above the appointment total.

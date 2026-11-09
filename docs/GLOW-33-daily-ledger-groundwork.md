# GLOW-33 daily ledger groundwork

`aggregateDailyLedger` groups already-authorized `payment_entries` by their
`occurred_at` date in the salon's IANA time zone. It returns received and
refunded minor-unit amounts by tender method, plus the day's net ledger movement.
It rejects mixed tenants or currencies, malformed amounts and timestamps,
overflow, and more than 2,000 input rows without returning partial totals.
Malformed source times such as `24:00:00` are rejected instead of silently
rolling a payment into another day.
Report filters reject year zero, and an empty or whitespace-only tenant scope
is invalid even when no rows are supplied.

This helper performs no database read and grants no reporting permission. A
future server caller must verify reporting authorization, query only the
authenticated salon's rows under RLS, and use server-side paging or an indexed,
tenant-scoped aggregate for larger date ranges. The existing ledger index starts
with `appointment_id`, so it is not suited to a tenant-and-date report. No
hosted migration or permission change is included here.

The current ledger does not identify tips or deposit versus final tender. Its
entries are not equivalent to invoice gross sales or completed appointments.
Stripe sandbox reservations are separate records and must not be counted as
real revenue. Therefore this helper deliberately does not label any result
as gross sales, deposits, tips, or revenue.

Before the full GLOW-33 dashboard can be released, the product and finance
owners must define settled/completed record criteria, deposit and tip
classification, gross-sales and refund attribution, and who among staff may
see reports. A reviewed schema/index and owner- or permission-scoped reporting
query will then be needed, followed by authorization, time-zone, and production
verification. GLOW-33 remains In Progress.

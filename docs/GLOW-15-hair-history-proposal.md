# GLOW-15 hair formula and patch-test history proposal

Status: draft schema and authorization contract. This is not a migration or a
completed client feature. No hosted SQL or customer data is changed by this
proposal. GLOW-16 owns the generic client profile at
`/${locale}/dashboard/clients/${clientId}`; a hair-specific child page should
follow only after the record model is reviewed and deployed.

## Why the current schema cannot meet the story

The historical baseline gives `public.clients` a `hair_formulas` JSON array
and a `patch_test_history` JSON array. The only constraints check that each
value is an array. They do not require formula, developer strength, processing
time, result, service date, patch-test result, author or appointment reference.
Current client RLS allows any member of the tenant to update and delete the
whole client row. A client-form edit could therefore replace or erase old
entries without an audit trail. `public.appointments` stores a scheduled
client and staff, but a booking is not proof that a service or patch test was
performed. Joining an old appointment to a mutable service catalog would not
restore the actual formula used. Do not add a production editor that appends
to either JSON array and call it history.

## Proposed immutable records

Create two private, tenant-owned record tables through a reviewed forward
migration. Keep the legacy JSON arrays untouched until their contents and a
safe migration path have been assessed. Do not infer records from bookings.

| Record | Required data | Optional data | Immutable linkage |
| --- | --- | --- | --- |
| `client_hair_formula_records` | tenant, client, salon-local `performed_on` date, formula text, developer strength label and unit, processing minutes, result notes, performing staff, creator, creation timestamp | same-client appointment, correction target | client and staff must belong to tenant; appointment, when present, must belong to both tenant and client |
| `client_hair_patch_test_records` | tenant, client, salon-local `applied_on` date, observation status, performing staff, creator, creation timestamp | observation date, allergy/reaction notes, same-client appointment, correction target | same tenant/client and staff checks as formula records |

Give each row its own UUID and an optional `replaces_record_id`. A correction
inserts a new row referencing an earlier row of the same table, tenant and
client; it never updates the original. Prevent two direct replacements of one
row. Preserve all rows for audit, but show only effective (not superseded)
records in the default history. Order effective records by salon-local service
or application date descending, then creation timestamp and UUID for stable
ties. Show a correction marker and allow authorized staff to inspect earlier
versions. A `date` is a local calendar fact; never derive or display it by
converting a UTC timestamp through the viewer's time zone.

Store `performing_staff_id` and `created_by` as distinct identities on both
record types. The former identifies who actually performed the service or
test; the latter identifies the authenticated person who entered this version.
They may differ, especially for a correction. A replacement must retain its
own `created_by` while the original author and performer remain visible in
the audit trail. Validate each identity against the same tenant using
`public.users (id, tenant_id)`; do not infer the performer from an appointment's
assigned staff or from editable Auth metadata.

For patch tests, proposed observation statuses are `awaiting_observation`,
`no_reaction_observed`, `reaction_observed` and `inconclusive`. Reading a test
later appends a replacement record with the observation date and status. The
interface must not claim that `no_reaction_observed` medically clears a client
for treatment. Allergy/reaction notes are sensitive and must never enter
public search, booking confirmation, notifications or logs.

## Database authorization contract

1. Enable RLS on both exposed `public` tables. Revoke default access from
   `PUBLIC`, `anon` and `authenticated`, then explicitly grant only `SELECT`
   and `INSERT` to `authenticated`. Pair those grants with a tenant-member
   `SELECT` policy and an `INSERT WITH CHECK` policy requiring tenant
   membership and `created_by = auth.uid()`. Neither SQL grants nor the
   authenticated role alone establish tenant authorization. There must be no
   anonymous access or public RPC. Do not use a service-role client for the
   staff workflow or trust editable user metadata for authorization.
2. Enforce `(client_id, tenant_id)`, `(performing_staff_id, tenant_id)` and
   `(created_by, tenant_id)` with tenant-scoped keys. A nullable appointment
   reference must also enforce `(appointment_id, tenant_id, client_id)`.
   Current appointments have `UNIQUE (id, tenant_id)`, not the required
   three-column key. Coordinate one shared supporting `UNIQUE (id, tenant_id,
   client_id)` or an equivalent database guard with GLOW-14 rather than
   inventing separate, inconsistent appointment checks. A correction
   reference must enforce the same tenant and client.
3. Revoke application-role `UPDATE` and `DELETE` and add a database guard that
   rejects those operations, including accidental privileged writes. An
   insert-only policy alone does not protect against service-role or future
   grants. Limit text lengths and processing minutes with database checks.
4. Read the client and records through the signed-in member's session,
   filtered by both `tenant_id` and `client_id`. Fail closed on missing client,
   authorization or query errors. Do not expose the records through a public
   profile or booking endpoint.
5. Decide retention, export, correction and erasure policy for allergy notes,
   clients and former staff authors before migration, together with GLOW-14.
   A hard FK to `public.users` may block account deletion; silently nulling
   either identity loses provenance. Append-only audit needs an explicit
   lawful erasure or retention path rather than an undocumented exception.

Current Supabase RLS guidance requires RLS on exposed tables and stresses
that SQL-created tables need explicit role grants. Tenant membership must be
checked in the policy as well as the role. The present `clients` policy is
appropriate for mutable client contact details, not immutable treatment
history.

## Verification required in the migration and UI PRs

- Local PostgreSQL tests: owner and staff can read and append in their own
  tenant; anonymous, non-member and other-tenant reads/inserts fail. Spoofed
  `created_by`, cross-tenant performer or creator, and appointment for another
  client are rejected. Assert both table grants and RLS policies so one cannot
  conceal a missing or overly broad other. An existing appointment cannot be
  reassigned to another client after a linked record is inserted. Direct
  update/delete, including a privileged accidental path, fail. Same-client
  corrections work; cross-client corrections and competing replacements fail.
  No test should require hosted SQL.
- Read-model tests: effective records exclude superseded versions; stable
  descending local-date order works across ties; pending and later observed
  patch tests preserve both entries; absent records show an honest empty
  state. Historical JSON must never be silently discarded or treated as
  verified new rows.
- UI/browser tests after GLOW-16 integration: authenticated tenant-scoped
  client route, invalid UUID and query-error denial, FR/EN/ES labels, narrow
  mobile layout and touch targets, visible staff/service dates, correction
  context, and no public or cross-tenant exposure.

## Decisions before migration

- Confirm acceptable formula detail and developer-strength units. Free text
  can preserve a salon's actual mixture, but structured product quantities
  may be needed for reproducibility and inventory later.
- Confirm whether a patch test may be logged without a booked appointment.
  New entries should identify the actual performing staff member, not assume
  the appointment's assigned staff. Decide how to handle historical records
  with an unknown performer before any import.
- Decide one coordinated legacy-data policy with GLOW-14. Keep the existing
  hair JSON arrays untouched pending provenance review; `nail_preferences`
  may remain a mutable preference summary but is never audited visit history.
  Any reviewed historical import must carry explicit uncertain provenance,
  or the legacy fields must be excluded from verified history. Never overwrite
  them, invent an author or performer, or silently represent a booking as a
  completed treatment.
- Approve a shared retention/export/erasure and former-staff provenance
  framework for hair, patch-test and nail records. Data-class rules may differ,
  especially for allergy notes and photos, but client or staff deletion must
  have a reviewed outcome for every linked record. Do not collect additional
  health information or store patch-test photos under this story without a
  separate privacy and Storage contract.

The GLOW-14 nail-history proposal uses the same append-only, tenant-authorized
correction pattern in separate files. GLOW-16 owns generic contact, notes and
read-only appointment history. A later hair child route can link from that
profile without changing its generic client form.

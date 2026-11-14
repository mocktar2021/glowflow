# GLOW-14 nail history: schema and security proposal

Status: draft contract, **not a deployable migration or a finished feature**. No hosted database, Storage, or customer data has been changed. The GLOW-16 client profile may be linked to a future `/${locale}/dashboard/clients/${clientId}/nails` page after the model and migration below are reviewed.

## Why the existing schema is insufficient

`public.clients.nail_preferences` is one mutable JSON object protected by client tenant RLS. It can hold present preferences, but changing it destroys the prior values and it has no visit date, author, or correction trail. `public.appointments` snapshots the service title and price, not `services.category` or treatment type. Joining an old appointment to the *current* service category can misclassify that appointment after a catalog edit. A booking is not proof that a nail treatment, especially an infill, was performed. There is no private, client-linked nail photo metadata model. The current schema therefore cannot truthfully satisfy prior nail services, last infill, or photo metadata.

## Proposed record contract

After product and privacy review, add a forward-only `public.client_nail_service_records` table with a UUID primary key, `tenant_id`, `client_id`, optional `appointment_id`, salon-local `performed_on date`, required `service_kind` (`new_set`, `infill`, `removal`, `repair`, `other`), optional shape, product type, shade and design notes, `created_by`, `created_at`, and optional `replaces_record_id`. Records are append-only. Staff corrections insert a replacement row, preserving the original and its author; a unique replacement constraint prevents competing direct corrections. Both appointment and replacement links must be validated against the *same tenant and client*, not just a row ID. Existing `nail_preferences` can remain a separate mutable summary, never an audit source.

For photos, propose a separate `public.client_nail_photo_metadata` table keyed to an immutable record and the same tenant/client, with a private object key, MIME type, byte count, alt/caption text, capture timestamp, creator, and creation timestamp. Do not put public URLs or image bytes in `nail_preferences`. Storage bucket policy, who may upload/view, retention and deletion, and client permission for storing photos need explicit decisions before photo upload or display is implemented. Until then the metadata table and UI should not be deployed independently as if photos worked.

`lastInfillDate` in `lib/nails/history.ts` is a pure read-model helper for append-only records. It excludes replaced records and non-infill services, returning `null` when there is no evidenced infill. It requires the **complete client history, including corrections**, not a paginated slice; otherwise the latest infill could be omitted or a replaced infill could appear current. A future UI must fetch the complete effective set or use a dedicated tenant-scoped database aggregate. `performed_on` is a salon-local SQL `date`, so sorting is by ISO calendar date, not browser or appointment time zone.

## Security and acceptance gate

1. Enable RLS on both new tenant-owned `public` tables and explicitly grant authenticated members only `SELECT` and `INSERT` for the Data API. Owner and staff can access only rows for their membership tenant, with `created_by = auth.uid()` on insert. Revoke all anonymous table privileges and all application-role `UPDATE` and `DELETE` privileges; anonymous and other tenants must not read or insert. A database immutability guard must also protect records from accidental privileged updates. Service role should not be used for this staff workflow.
2. Enforce `(client_id, tenant_id)` and `(appointment_id, tenant_id, client_id)` consistency with composite keys or a narrowly scoped database check. The current appointment schema has only `(id, tenant_id)` unique; GLOW-14 and GLOW-15 need one shared supporting key or guard for the optional same-client link, not competing independent changes. A correction link must also reference the same tenant and client. Enforce creator membership within the same tenant and validate length/size limits for text and metadata. Avoid exposing private photo object keys in public booking responses.
3. On the future client-profile route, load the client by UUID **and tenant_id** using the signed-in member's Supabase session. All record and photo queries must also filter tenant_id and client_id. Fail closed on authorization or query errors. Do not use an admin client.
4. Show latest effective infill and prior performed services; distinguish an appointment booking from a completed service record. Corrections must remain auditable. Mobile entry needs 44px or larger controls and works at narrow viewport widths. Supply FR, EN and ES copy without em dashes.
5. Local Postgres tests must exercise owner, staff, anonymous, and cross-tenant access; direct update/delete refusal; foreign-client/appointment rejection; replacement-chain behavior; and photo metadata isolation. App tests must cover route authorization, invalid UUID, query failure, localized empty state, and mobile form behavior. CI must run the database suite, not merely discover it.

## Decisions required before a production migration

- Confirm service kinds and whether a correction may change `performed_on` and treatment type. The draft helper supports both by treating the replacement row as effective.
- Choose the privacy policy for client nail photos: permission, retention, export and deletion, plus private Storage authorization. This task makes no Storage change.
- Decide whether a nail record may be entered without an appointment and whether historical records are backfilled manually. Never infer a performed treatment from an existing booking.
- Choose a shared actor model with GLOW-15: `created_by` identifies the editor, while an optional or required performing staff member identifies who did the treatment. Do not assume the booking's assigned staff performed it.
- Agree whether `nail_preferences` is still maintained separately or derived from the latest effective service record.
- Decide record retention, export, correction, and erasure policy, including what happens to the author reference when a staff account is removed. Hard-deleting the author must not silently erase provenance.

The GLOW-16 profile path is `/${locale}/dashboard/clients/${clientId}`. Its owner will leave nail-specific UI out of that PR. Once the reviewed data model is implemented, add a small integration link to its own nails child route; do not merge an orphaned or misleading page now.

# GLOW-56 ambiguous public booking recovery

The current code-only safeguard applies to the mounted public booking page. If a
POST has no authoritative result, the page hides the editable form and keeps the
original payload and request key in memory. The only in-page action retries that
exact pair. A valid confirmation for the originally requested instant shows the
stored appointment. A definite `slot_unavailable` or `invalid_request` on the
first attempt releases the form for a new request. Once an attempt is uncertain,
even a later 400/409 cannot prove the original request will not arrive and
commit after the retry. In that state only a valid same-key confirmation
unlocks the page. Network errors, server failures, and malformed or wrong-time
confirmations also remain uncertain. The warning and recovery action are
available in French, English, and Spanish. No client contact data is written to
browser storage.

The recovery action is explicitly labeled as a retry because it can create the
original booking if the first POST never reached the server. It is not a
read-only status check.

This is not a cross-session guarantee. Refreshing, opening another tab or
device, clearing browser state, or leaving the page loses the in-memory pending
request. The current API has no privacy-safe way to recover that original
payload and key after navigation. Visitors are told to keep the page open and
contact the salon if the original request cannot be confirmed. Do not mark
GLOW-56 complete or claim duplicate-booking prevention across sessions on this
UI change alone.

## Proposed durable contract for separate review

Prepare a server-side booking attempt before any appointment-creating request.
Return only an unguessable recovery handle to the browser; keep contact details
and the immutable booking payload in a private, tenant-scoped server record,
never in a URL or browser storage. Commit and reconcile endpoints would use the
same attempt key under a PostgreSQL transaction or advisory lock, return the
stored appointment when committed, and distinguish a definitively failed
attempt from a still-pending or unknown one. A missing row alone cannot prove
non-commit while an earlier request may still arrive, so the design must fence
late requests before reporting a safe new-attempt state. Limit token lifetime,
rate-limit lookups, avoid logging handles or contact data, and return only the
minimum confirmation fields needed by the visitor. Review RLS/grants, privacy,
rollback, and migration behavior before adding this API or applying SQL.

The disposable browser fixtures model a server commit followed by a lost
response, and an original request that commits after an early retry 400/409. Both
prove the active page sends no changed-key request. The local
PostgreSQL test checks that a same-key, changed-time replay returns the first
appointment rather than creating another. Neither test is a live booking.

# GLOW-56 same-browser booking intent contract

Status: design proposal only, 4 November 2026. This document contains no
executable migration, API route, feature flag, or activation. Draft PR #178
protects only an active page and remains a partial safeguard. This proposal
addresses recovery after reload, a new tab, and a browser restart within a
bounded cookie lifetime. Cross-device recovery is deferred by product decision.

## Problem and required invariant

The current `/api/public-booking` POST accepts a visitor-supplied UUID request
key. PostgreSQL deduplicates `(tenant_id, public_booking_request_key)` and
rejects overlapping resource time, but a lost 201 followed by a new key for a
different time can create two appointments. Draft PR #178 holds the first key
and payload in memory, which disappears on navigation. A lookup returning no
appointment cannot prove that an original POST will not arrive and commit later.

**Invariant:** after a booking intent is prepared, either its original payload
may commit once, or an atomic terminal transition makes every later commit of
that intent impossible. A changed payload/new request key is permitted only
after authoritative confirmation or a terminal noncommit transition. A timeout,
missing cookie for a known attempt, failed lookup, or lost response is never a
definitive failure. A genuinely first-time browser with no known attempt may
prepare one; cookie absence alone must not be presented as evidence that an
earlier booking did not occur.

This protects an honest visitor recovering one attempt in the same browser. It
cannot identify two independent browsers, private profiles, cleared cookies, or
a visitor deliberately creating separate keys. Do not claim cross-device or
identity-based deduplication for MVP. If the visitor clears **all** site data,
both the recovery cookie and the independent pending marker proposed below
disappear. The app cannot detect that a prior attempt existed; this is an
explicit, undetectable limit of anonymous same-browser recovery.

## Existing boundaries to preserve

- `app/api/public-booking/route.ts` validates booking input and calls the
  service-role-only `public.create_public_appointment` RPC. Its GET returns
  availability. Neither route currently reconciles a prior attempt.
- `supabase/migrations/20261015011001_enforce_public_booking_slot_integrity.sql`
  has authoritative slot, staff, publication, and resource checks. Its existing
  key lookup happens after start and catalog validation, so a late same-key
  retry can fail after the time passes or the catalog changes. The v2 confirmed
  path must read the stored appointment before calling this function again.
- The existing appointment `(tenant_id, public_booking_request_key)` unique
  index and resource overlap protection remain backstops. No v2 path may bypass
  them. Payment, reminder, and message processing are outside this contract.

## Private persistence proposal

Use a new `private.public_booking_intents` table in a separately reviewed
versioned migration. The `private` schema is not exposed through the Data API.
Enable RLS even there as defense in depth; grant no table access to `PUBLIC`,
`anon`, or `authenticated`. Only the server's service role can use narrow RPCs.
The proposed columns are:

| Column | Purpose |
| --- | --- |
| `id uuid` primary key, `tenant_id uuid` foreign key | Tenant-scoped intent identity. |
| `browser_token_hash bytea` | SHA-256 of a server-generated 256-bit bearer token; never store the raw cookie. |
| `request_key uuid` | Server-generated once; unique with `tenant_id` and reused only for this intent. |
| `state text` | Constrained to `prepared`, `committed`, `canceled`, or `expired`. |
| `service_id`, `staff_id`, `requested_start`, `locale` | Immutable normalized booking inputs. |
| `client_full_name`, `client_phone`, `client_email` | Private, short-lived contact inputs needed to retry unchanged after reload; nullable so terminal rows can be scrubbed. |
| `appointment_id uuid` nullable | Stored result of the same database transaction that commits the booking. |
| `created_at`, `expires_at`, `terminal_at`, `acknowledged_at` | Lifetime, terminal-state, and explicit new-booking controls. |

Require a unique `(tenant_id, request_key)` index and a partial unique
`(browser_token_hash, tenant_id)` index for `prepared` **or unacknowledged
`committed`** intents. A second tab cannot silently prepare a different time
for that browser and salon while the first intent is unresolved. Concurrent
prepares that hit this index must return the existing locked/confirmation
state, not an unclassified 500. A committed intent also blocks automatic
preparation of a new intent until the browser explicitly acknowledges the
confirmation or chooses “Book another appointment.” Server code must not let
the browser edit the stored booking inputs, request key, or state directly.
When prepare finds a prior `prepared` row past expiry, it must lock that same
row, recheck wall time after waiting, mark it `expired`, and scrub contact data
before inserting a new intent in the same transaction. Otherwise the partial
unique index would block preparation indefinitely. If the original commit
held the lock first, prepare instead observes `committed` and returns the
stored confirmation. If expiry wins first, the old commit must reject.

The duplicate contact copy exists only while `prepared`; scrub it when an
intent becomes committed, canceled, or expired. Illustrative values for later
privacy and operator review, **not approved defaults**, are 24 hours for a
prepared intent and 7 days for the persistent cookie and terminal-row
retention. The migration track uses a private policy singleton with **no seed**:
preparation must fail closed until TTL/retention values receive separate
approval and are explicitly provisioned. Missing rows must reject v2 commit,
so cleanup cannot reopen a late POST. Appointment/client records keep their
own existing retention rules.

## Same-browser capability and HTTP contract

On first successful preparation, generate the browser token with a
cryptographic random source and set `__Host-glowflow_booking_recovery` as a
host-only, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` cookie with bounded
`Max-Age`. The same origin shares it across tabs and browser restarts during
that lifetime. Each prepared intent also has a non-secret `id` carried in POST
bodies, never in a URL; the server requires both that ID and the cookie token
hash to address an intent. A new tab recovers the current ID through the
cookie-scoped reconcile endpoint. This binding is essential: a delayed POST
for canceled intent A must not accidentally commit newer intent B under the
same browser cookie. QA (`glowflow.mocktar.com`) and future production
(`glowflow.beauty`) have separate host-only cookies. The browser never receives
the request key or a contact-bearing recovery payload.

Keep the submit action disabled until cookie-backed preparation succeeds.
Two truly simultaneous first visits before a shared cookie exists can still
become independent anonymous sessions; without visitor identity the system
cannot merge them reliably. An orphaned prepared row whose prepare response
was lost cannot create an appointment, because the client has no intent ID to
send to commit, and will expire safely.

This chooses an HttpOnly cookie over localStorage/sessionStorage **for the
recovery capability**: JavaScript cannot read or accidentally log it, and no
contact PII is written to browser storage. A separate, non-sensitive
localStorage marker records only that an attempt may be unresolved if the
cookie is later missing. Use one marker per public salon slug, with only a
boolean/version value; store no name, contact, time, intent ID, request key,
bearer token, or confirmation. Set it synchronously after preparation succeeds
and **before** sending the appointment-creating commit POST. If that write
fails or storage is unavailable, fail closed and do not send commit until an
equivalent independent marker is available. Preparation alone cannot create
an appointment, so a crash before marker creation leaves a safe orphan.

On page load or in a new tab, reconcile before enabling a new booking whenever
the cookie or marker exists. A marker with no cookie means **unknown**, not
“no previous booking”; keep changed booking disabled and offer a salon support
path. A valid cookie with no marker still requires reconciliation; restore the
marker before any recovered original-commit retry. Remove the marker only
after a confirmed appointment or a row-locked terminal noncommit result. A
missing row, timeout, lost response, or user action that merely
clears the cookie must not clear the marker or authorize a new key. The marker
is an advisory UI fail-closed signal, never a database capability or proof of
noncommit. Clearing all site data removes both signals and cannot be detected;
a genuinely fresh browser may prepare, but the UI must not claim to have ruled
out an earlier booking. The implementation review may choose a different
independent non-sensitive marker with the same ordering and loss semantics.

An XSS could still issue same-origin requests, and anyone using that browser
profile within the TTL has the capability; it is not visitor identity. Require
exact allowed Origin, same-origin Fetch Metadata where
available, JSON content type on modifying POSTs, no permissive CORS, and
`Cache-Control: private, no-store` on all responses. Apply bounded rate limits
to preparation and recovery. Never put the cookie, raw token, contact data,
request key, raw database error, or appointment identifiers in URLs or logs.
Diagnostics must use fixed allowlisted fields only. A clear-cookie action may
remove local recovery access, but must not label an unresolved intent safe to
rebook. Clearing browser data likewise forfeits recovery; show a safe salon
contact path, not a silent new booking.

The Next.js handlers use `createAdminClient()` only on the server. Proposed
service-role-only public RPC wrappers are needed because Supabase's Data API
does not expose `private` schema functions by default. Keep the table and any
internal helpers in `private`; for each public wrapper explicitly revoke
`EXECUTE` from `PUBLIC`, `anon`, and `authenticated`, grant only `service_role`,
fix `search_path = ''`, and schema-qualify all objects. Prefer invoker rights
when service-role privileges suffice; review any necessary definer rights
separately. Direct Data API table reads and client-side RPC calls are forbidden.

| Handler and internal operation | Request and response contract |
| --- | --- |
| `POST /api/public-booking/intent/prepare` | Accept the current booking fields except `requestKey`; validate and normalize them, resolve published tenant, then create or return the same prepared intent under the browser cookie. Return its non-secret `intentId`. A different unexpired, unresolved payload returns a generic locked state, not a new key; an unacknowledged committed intent returns its existing confirmation. An expired prepared row is locked and marked terminal before a new one is inserted. Durable intent creation must finish before the client may call commit. |
| `POST /api/public-booking/intent/commit` | Accept `salonSlug` and `intentId` only; load immutable payload by `(tenant_id, intent_id, token_hash)`, lock that row, and call the existing appointment creation logic with the stored key in the same transaction. Return the original confirmation on replay. No client-supplied contact/time/key is accepted here. |
| `POST /api/public-booking/intent/reconcile` | With `intentId`, lock that exact row; without one after reload, select the sole unresolved/unacknowledged intent for the browser and tenant, or the most recent terminal one. Return `prepared`, `confirmed`, or `not_committed` only from authoritative state and include the non-secret `intentId` for an original retry. A `prepared` result allows retrying the original commit, not editing. A missing/invalid cookie for a known attempt, timeout, or database error is `unknown`; it must not unlock another booking. |
| `POST /api/public-booking/intent/cancel` | Require `intentId`; under the same row lock, change that exact `prepared` intent to `canceled` (or expired if past deadline), scrub contact fields, and return definitive `not_committed`; if already committed, return the stored confirmation instead. This operation never cancels an existing appointment or a newer intent. |
| Explicit new-booking acknowledgement | Only after a displayed confirmation or terminal noncommit, record acknowledgement and permit preparation of a different payload. Never interpret a generic 400/409/500 from an old request as this acknowledgement. |

All endpoints return only the minimum salon/time/reference confirmation fields
needed by the visitor, with no contact values. Invalid or foreign capabilities
must not reveal whether another tenant's intent exists. Use the tenant derived
from the public salon slug for every lookup. API statuses and FR/EN/ES copy
must distinguish “may have succeeded”, “retry original request”, “confirmed”,
and “definitively not committed” without claiming a fresh commit is read-only.
On mobile, keep the warning and original-retry action keyboard/screen-reader
accessible. Do not rely on a GET that merely finds no appointment to unlock.

## State machine and delayed-POST fence

| State under intent-row lock | Commit | Reconcile/cancel |
| --- | --- | --- |
| `prepared`, before expiry | Create at most one appointment and set `committed` in the **same transaction**; on a retryable error remain `prepared`. | Reconcile says pending. Explicit cancel atomically sets `canceled` and scrubs PII. |
| `prepared`, after expiry | Refuse to create an appointment, checking wall time **after** acquiring the lock. | Atomically set `expired`, scrub PII, return definitive noncommit. |
| `committed` | Return stored appointment before any current start/catalog check; never create another. | Return minimal stored confirmation; do not cancel the appointment. |
| `canceled` or `expired` | Reject even if the original POST arrives late. | Return definitive noncommit. |
| missing row or unavailable database | Reject commit. | Return `unknown`, not a permission to rebook. |

The v2 commit and cancel/expiry functions must acquire the **same row lock**.
If the original commit holds it first, cancellation waits and sees `committed`.
If cancellation holds it first, the delayed commit sees `canceled` and rejects.
The appointment insert and `committed` update share one database transaction;
neither may become visible alone. A slot conflict or generic API error does not
by itself prove noncommit, so the UI remains locked until row-locked
reconciliation or cancellation succeeds. For committed recovery, read the
stored appointment by tenant and request key even if the original slot is now
past or the catalog is unpublished; if the appointment later became canceled,
show its actual state or a support path, never an invented active confirmation.

## Rollout, compatibility, and rollback gate

1. Separate design review, privacy review, and a versioned migration PR must
   precede any hosted database work. Inspect exact GlowFlow project identity,
   migration ledger, schema fingerprints, grants, RLS, and rollback plan. Hosted
   SQL/db push requires separate explicit approval; this design PR grants none.
2. Apply the approved private table/wrappers dormant, with local database RLS
   and concurrency tests first. No payment, reminder, or message activation.
3. Ship API and FR/EN/ES UI behind a disabled-by-default booking-intent gate.
   Verify prepared, committed, canceled, and expired paths in an isolated
   environment before changing public booking traffic.
4. Cut over only with an explicit legacy drain. The current public POST accepts
   arbitrary request keys and would bypass the intent fence if left callable.
   Gate or retire that route and its legacy RPC at cutover, stop new legacy
   bookings briefly, and wait for already-started legacy requests/transactions
   to finish before claiming v2 protection. Existing old-page attempts that
   lack an intent cannot be safely reconstructed; show a conservative manual
   recovery path. Do not enable v2 while a legacy bypass remains.
5. A rollback must disable **new** prepares and keep v2 reconciliation and
   commit support for existing intents until drained. Reverting to an
   arbitrary-key legacy POST or dropping active intent rows is not a safe
   rollback. Terminal rows may be pruned only after v2 rejects missing rows.

## Local verification required before any later release

- Deterministic fixture and disposable local PostgreSQL race: server commits,
  201 is lost, page reloads/new tab opens, reconcile returns the same stored
  appointment, and no second appointment appears.
- Delay the original commit while cancel races. Test both lock orders: commit
  first returns confirmation; cancel first fences the late POST, including
  after a new intent is prepared under the same browser cookie. Repeat at
  expiry and with same-key concurrent commits. Verify only one client and
  appointment are created when a commit wins.
- Verify true noncommit, slot conflict, catalog/time changes after commitment,
  malformed confirmation, cookie loss, browser restart within TTL, and expiry.
  A false 400/409, timeout, or missing row must never unlock a changed booking.
- Browser fixtures must persist the boolean salon marker before commit, then
  reload with only the marker (cookie missing) and prove the UI stays locked
  with a support path. Cover marker-only, cookie-only, both, neither on a
  genuinely fresh visit, failed marker storage, and marker removal only after
  authoritative confirmation/noncommit. Document that clearing all site data
  makes any earlier anonymous attempt undetectable.
- Concurrent tabs under one browser cookie cannot prepare different unresolved
  intents for the same tenant. An explicit “Book another” after confirmation
  can prepare a new intent; background retry cannot.
- Race prepare against expiry and an original commit. If expiry obtains the row
  lock first, scrub/terminalize the old row before inserting a new intent and
  prove the old POST cannot commit. If commit wins first, prepare must return
  its confirmation rather than a new key. A fresh no-cookie browser may prepare
  once, subject to the documented simultaneous-first-tab limitation.
- Test anonymous/authenticated direct table and RPC denial, owner/staff and
  cross-tenant isolation, forged token/key, CSRF Origin/Fetch-Metadata checks,
  response no-store, fixed redacted logs, and absence of contact PII or bearer
  capability in localStorage/sessionStorage, URLs, and client diagnostics.
- Run FR/EN/ES accessible mobile browser fixtures, full CI, database security,
  and existing booking-overlap tests. Use no hosted booking POST, payment,
  message, telemetry activation, or hosted SQL for these local tests.

No design review, migration, hosted preflight, deployment, or live behavior is
claimed complete by this document. Keep GLOW-56 In Progress until the complete
contract and production verification exist.

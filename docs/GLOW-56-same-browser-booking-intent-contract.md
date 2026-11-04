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

Use a new `private.public_booking_intents` table and
`private.public_booking_browser_sessions` in a separately reviewed versioned
migration. The session row is unique by `(tenant_id, browser_token_hash)` and
holds a random UUID `generation` for prepare preconditions. The `private` schema is not
exposed through the Data API. Enable RLS on both tables as defense in depth;
grant no table access to `PUBLIC`, `anon`, or `authenticated`. Only the server's
service role can use narrow RPCs. The proposed intent columns are:

| Column | Purpose |
| --- | --- |
| `id uuid` primary key, `tenant_id uuid` foreign key | Tenant-scoped intent identity. |
| `browser_token_hash text` | Lowercase hex SHA-256 of a server-generated 256-bit bearer token; never store the raw cookie. |
| `request_key uuid` | Server-generated once; unique with `tenant_id` and reused only for this intent. |
| `state text` | Constrained to `prepared`, `committed`, `canceled`, or `expired`. |
| `service_id`, `staff_id`, `requested_start`, `locale` | Immutable normalized booking inputs. |
| `client_full_name`, `client_phone`, `client_email` | Private, short-lived contact inputs needed to retry unchanged after reload; nullable so terminal rows can be scrubbed. |
| `appointment_id uuid` nullable | Stored result of the same database transaction that commits the booking. |
| `released_generation uuid` nullable | Generation produced by an acknowledged/canceled/expired release; exact-ID terminal replay cannot substitute a later session generation. |
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
and rotate the session generation in the same transaction. It returns terminal
noncommit and the new generation; it does **not** insert a new intent under the
stale generation in that request. Otherwise the partial unique index would
block preparation indefinitely. If the original commit held the intent lock
first, prepare instead observes `committed` and returns the stored
confirmation. If expiry wins first, the old commit must reject.

The duplicate contact copy exists only while `prepared`; scrub it when an
intent becomes committed, canceled, or expired. The owner approved the short
same-browser MVP bundle on 2026-11-04: a 2-hour prepared-intent TTL, a 24-hour
recovery cookie, and 3-day retention for terminal intent records. Effective
prepared expiry is the earlier of the requested slot start and the 2-hour TTL.
These values do not authorize activation or a hosted policy seed. The migration
track uses a private policy singleton with **no seed**: preparation must fail
closed until the reviewed values are explicitly provisioned under a separate
hosted approval. Missing rows must reject v2 commit, so cleanup cannot reopen
a late POST. Appointment/client records keep their own existing retention
rules.

Lazy expiry on a later visitor request is **not** sufficient: if nobody
returns, a `prepared` row could retain contact PII indefinitely. Before the
v2 booking gate can accept traffic, a separately reviewed scheduled cleanup
or purge runner must have an approved cadence, owner, failure signal, and
bounded retention policy. It scans candidate IDs without first locking an
intent row, then for each candidate acquires the browser-key advisory lock,
session-row lock, and intent-row lock in that order. After waiting, it rechecks
state and wall-clock expiry. If still `prepared` and expired, it atomically
marks `expired`, scrubs contact fields, and rotates generation once, leaving a
tombstone that rejects a delayed commit. If commit won the intent lock first,
cleanup sees `committed` and must not turn it into noncommit. A separate
approved terminal-row purge can later delete scrubbed tombstones after 3 days,
since v2 commit rejects missing intents. The 3-day retention exceeds the
24-hour cookie lifetime so recovery is possible throughout that lifetime.
Delete old browser session hashes/generations only after cookie lifetime plus
a safe grace period and after no intent references them; cleanup must never
make an old generation valid again. A replayed raw cookie must still be
rejected after 24 hours, including after its session hash is purged. The
session age therefore needs a server-enforced, non-resettable proof of issue
time; browser `Max-Age` alone is not a security boundary. The cleanup cadence,
operator, failure alert, and session grace still require review. No cleanup
job, schedule, policy row, or hosted SQL is enabled by this design PR; the
dormant, unseeded migration must still fail closed.

## Same-browser capability and HTTP contract

On the dedicated `bootstrap` action, generate the browser token with a
cryptographic random source and set
`__Host-glowflow_booking_session` as a host-only, `Secure`, `HttpOnly`, `Path=/`
cookie. Prefer `SameSite=Strict` if
QA verifies marketplace-to-booking navigation and same-browser recovery;
otherwise document the reason for `Lax` and keep the same CSRF checks. Cookie
`Max-Age` comes from the required, validated **server-only**
`GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS` setting whenever the v2
feature flag is enabled. The approved ceiling is 86400 seconds; the intended
activation setting for the chosen bundle is exactly 86400 seconds. A shorter
window changes the recovery promise and needs separate review. The server must
also reject a copied cookie after its 24-hour lifetime, not merely rely on
the browser to discard it.
An absent or invalid value blocks new cookie issuance and every `prepare`;
existing valid-cookie sessions may still reconcile, commit the original intent,
cancel, or acknowledge so ambiguous bookings can drain safely. Do not hardcode
a duration or expose it through `NEXT_PUBLIC_` configuration. The same origin
shares the cookie
across tabs and browser restarts during that lifetime. Each prepared intent
also has a non-secret `id` carried in POST bodies, never in a URL; the server
requires both that ID and the cookie token hash to address an intent. A new
tab recovers the current ID through the cookie-scoped reconcile action. This
binding is essential: a delayed POST for canceled intent A must not
accidentally commit newer intent B under the same browser cookie. QA
(`glowflow.mocktar.com`) and future production (`glowflow.beauty`) have
separate host-only cookies. The browser never receives
the request key or a contact-bearing recovery payload.

Keep the editable form disabled until bootstrap has established the cookie and
cookie-backed reconciliation supplies a generation; keep commit disabled until
cookie-backed preparation succeeds.
Two truly simultaneous first visits before a shared cookie exists can still
become independent anonymous sessions; without visitor identity the system
cannot merge them reliably. An orphaned prepared row whose prepare response
was lost cannot create an appointment, because the client has no intent ID to
send to commit, and will expire safely.

This chooses an HttpOnly cookie over localStorage/sessionStorage **for the
recovery capability**: JavaScript cannot read or accidentally log it, and no
contact PII is written to browser storage. A separate, non-bearer localStorage
marker records only that an attempt may be unresolved if the cookie is later
missing. Key each marker by a public salon slug and that attempt's
server-generated random `intentId`; its value can be only a boolean/version.
Store no name, contact, time, request key, bearer token, or confirmation. The
intent UUID alone authorizes nothing: every server action still requires the
matching HttpOnly cookie and tenant. Set the exact intent's marker
synchronously after preparation succeeds and **before** sending its
appointment-creating commit POST. If that write fails or storage is
unavailable, fail closed and do not send commit until an equivalent independent
marker is available. Preparation alone cannot create an appointment, so a
crash before marker creation leaves a safe orphan.

On page load or in a new tab, enumerate markers for that public salon and
reconcile each marked intent before enabling a changed booking. Exact-ID
recovery can return a terminal intent's stored release generation, which may
already be stale after a later booking. After clearing resolved exact-ID
markers, perform a no-ID reconcile to obtain the **current** session generation
before binding a new form; never replace it with a delayed terminal response.
**Any** marker for the salon with no cookie means **unknown**, not “no previous
booking.” Keep changed booking disabled and offer a salon support path. A valid
cookie with no marker still requires reconciliation; restore the returned
intent's marker before any recovered original-commit retry. Remove **only that
intent's marker** after that same intent has an authoritative confirmation or
row-locked terminal noncommit result. A delayed terminal response for old
intent A must
never erase newer intent B's marker, including across tabs. A missing row,
timeout, lost response, or action that merely clears the cookie must not clear
any unresolved marker or authorize a new key. Markers are advisory UI
fail-closed signals, never database capabilities or proof of noncommit.
Clearing all site data removes cookie and markers together and cannot be
detected; a genuinely fresh browser may prepare, but the UI must not claim to
have ruled out an earlier booking. These UUID-and-salon markers disclose
attempt count and salon interest to scripts or people with browser-profile
access, even though they contain no contact PII or bearer capability. Minimize
their lifetime by clearing only on authoritative per-intent resolution; review
that behavioral-privacy tradeoff before implementation. An alternative
generation-specific, non-bearer marker is acceptable only with the same
per-intent clear and any-marker fail-closed properties.

The server also owns a separate **browser-and-tenant generation**. Reconcile
bootstraps the private session if needed and returns its current random UUID
generation, including when the authoritative state is `none`. The page binds
that value to the form in memory, not localStorage. Every `prepare` sends the
captured `expectedGeneration`; the database compares it under a browser-key
advisory lock followed by the session-row lock and then any intent-row lock.
A stale generation rejects prepare without creating an intent, even if a tab
checked localStorage before another tab released the old booking and its HTTP
request arrived afterward. A mismatch requires a fresh reconciliation and
explicit user action; the UI must never silently replace the stale generation
and replay the old form. Acknowledging a committed intent, or terminally
canceling/expiring a prepared intent, rotates the generation in that same
transaction, exactly once for each terminal release. A newly bootstrapped
session with no cookie evidence cannot override an unresolved per-intent
marker: marker-plus-missing-cookie remains unknown and blocked despite a fresh
`none`/generation response.

An XSS could still issue same-origin requests, and anyone using that browser
profile within the TTL has the capability; it is not visitor identity. Require
exact allowed Origin, same-origin Fetch Metadata where available, JSON content
type on modifying POSTs, no permissive CORS, and
`Cache-Control: private, no-store` on all responses. Apply bounded rate limits
to preparation and recovery. Never put the cookie, raw token, contact data,
intent ID, request key, raw database error, or appointment identifiers in URLs
or logs. Diagnostics must use fixed allowlisted fields only. A clear-cookie
action may
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

One strict `POST /api/public-booking/v2` handler may dispatch on a required
`action` discriminant. Apply common exact-Origin, JSON content-type,
Fetch-Metadata, no-store, and disabled-by-default feature-gate checks before
dispatch. Use a **separate strict schema for each action**, rejecting unknown
fields; a commit, cancel, acknowledge, or reconcile body must not smuggle
contact, time, or request-key fields. HTTP consolidation does not combine
database transactions or relax the separate row-locked RPC contracts below.

| `action` on `POST /api/public-booking/v2` | Request and response contract |
| --- | --- |
| `bootstrap` | Accept only the action discriminant; set or validate the host-only cookie, without creating a booking or calling a database RPC. Missing/invalid server-only cookie lifetime prevents issuing a new token, but a valid existing cookie may continue recovery actions; `prepare` remains blocked. Then use `reconcile` for the salon to create/read its private session generation. |
| `prepare` | Require current booking fields and `expectedGeneration`, never a client `requestKey`; validate and normalize, resolve published tenant, then compare generation under the browser/session lock before creating or returning the same prepared intent. Return its non-secret `intentId`. A different unexpired, unresolved payload returns a generic locked state, not a new key; an unacknowledged committed intent returns its existing confirmation. A discovered expired intent is terminalized with generation rotation and a noncommit response; a new intent requires a later explicit prepare using the new generation. Durable intent creation must finish before the client may call commit. |
| `commit` | Accept `salonSlug` and `intentId` only; load immutable payload by `(tenant_id, intent_id, token_hash)`, lock that row, and call the existing appointment creation logic with the stored key in the same transaction. Return the original confirmation on replay. No client-supplied contact/time/key is accepted here. |
| `reconcile` | With `intentId`, lock that exact row and return its authoritative state, including a terminal tombstone and its stored release generation. Without an ID after reload, select the sole prepared/unacknowledged committed intent for the browser and tenant; if none exists, return `none` with the **current** session generation, never an older terminal tombstone. Bootstrap/return generation even on authoritative `none`. A `prepared` result allows retrying the original commit, not editing. A missing/invalid cookie for a known attempt, timeout, or database error is `unknown`; it must not unlock another booking. |
| `cancel` | Require `intentId`; under the same row lock, change that exact `prepared` intent to `canceled` (or expired if past deadline), scrub contact fields, rotate the browser/tenant generation atomically **once**, and return definitive `not_committed`; if already committed, return the stored confirmation instead. Duplicate or stale cancel cannot rotate again or affect a newer intent. This operation never cancels an existing appointment. |
| `acknowledge` | Accept `salonSlug` and `intentId` only after displaying that exact committed confirmation. Atomically mark only the current committed intent acknowledged and rotate the browser/tenant generation once. Duplicate or stale acknowledgement is idempotent: it never rotates again or affects a newer intent; its stored release generation may be stale, so a no-ID reconcile supplies the current generation before a new form. Return authoritative `none` plus top-level generation, never infer acknowledgement from a generic 400/409/500. |

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
| `prepared`, after expiry | Refuse to create an appointment, checking wall time **after** acquiring the lock. | Atomically set `expired`, scrub PII, rotate generation once, return definitive noncommit. |
| `committed` | Return stored appointment before any current start/catalog check; never create another. | Return minimal stored confirmation; do not cancel the appointment. |
| `canceled` or `expired` | Reject even if the original POST arrives late. | Return definitive noncommit. |
| missing row or unavailable database | Reject commit. | Return `unknown`, not a permission to rebook. |

The v2 commit and cancel/expiry functions must acquire the **same row lock**.
If the original commit holds it first, cancellation waits and sees `committed`.
If cancellation holds it first, the delayed commit sees `canceled` and rejects.
Every operation, including commit, uses the same lock order: browser-key
advisory lock, session row, then exact intent row. This ordering prevents a
stale prepare request
that arrives after a release from passing a client-side generation check made
before that release.

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
2. Apply the approved private tables/wrappers dormant, with local database RLS
   and concurrency tests first. No policy row or cleanup schedule is seeded by
   this step; no payment, reminder, or message activation.
3. Separately review, approve, and verify a scheduled expiry/PII-scrub and
   terminal-purge path using the approved 2-hour/24-hour/3-day bundle, plus its
   cadence, failure alert, session grace, and operating owner.
   Lazy request-driven transitions alone do not satisfy the activation gate.
4. Ship API and FR/EN/ES UI behind a disabled-by-default booking-intent gate.
   Verify prepared, committed, canceled, and expired paths in an isolated
   environment before changing public booking traffic.
5. Cut over only with an explicit legacy drain. The current public POST accepts
   arbitrary request keys and would bypass the intent fence if left callable.
   Gate or retire that route and its legacy RPC at cutover, stop new legacy
   bookings briefly, and wait for already-started legacy requests/transactions
   to finish before claiming v2 protection. Existing old-page attempts that
   lack an intent cannot be safely reconstructed; show a conservative manual
   recovery path. Do not enable v2 while a legacy bypass remains.
6. A rollback must disable **new** prepares and keep v2 reconciliation and
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
- Browser fixtures must persist a per-intent salon/UUID marker before commit,
  then reload with only that marker (cookie missing) and prove the UI stays
  locked with a support path. Cover marker-only, cookie-only, both, neither on
  a genuinely fresh visit, failed marker storage, and per-intent removal only
  after authoritative confirmation/noncommit. Specifically, delayed terminal
  response for intent A in tab A must not erase intent B's newer marker in tab
  B. Any marker plus missing cookie stays locked. Document that clearing all
  site data makes any earlier anonymous attempt undetectable.
- Concurrent tabs under one browser cookie cannot prepare different unresolved
  intents for the same tenant. An explicit “Book another” after confirmation
  can prepare a new intent; background retry cannot.
- Capture generation in tab A's form, then have tab B acknowledge a confirmed
  booking or cancel/expire a prepared one. An old prepare from tab A, including
  one sent before but delivered after the transition, must fail its server
  precondition without a new intent. Repeat with concurrent lock orders and
  prove duplicate acknowledgement/cancel never rotates generation twice or
  invalidates a newer intent. Reconcile returns generation even for `none`;
  the UI never silently retries the stale payload with that new generation.
- Race prepare against expiry and an original commit. If expiry obtains the row
  lock first, scrub/terminalize the old row, rotate generation, and return
  noncommit without inserting under stale generation; prove the old POST cannot
  commit. If commit wins first, prepare must return its confirmation rather
  than a new key. A fresh no-cookie browser may prepare once, subject to the
  documented simultaneous-first-tab limitation.
- Advance an idle prepared intent past its approved TTL without any visitor
  request, run the local cleanup worker, and prove contact fields are scrubbed,
  generation rotates once, and a late commit rejects. Race cleanup against
  commit in both lock orders; test repeated cleanup, terminal purge, missing
  policy, failed cleanup, and no client data or identifiers in cleanup logs.
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

# GLOW-56 capability action abuse budget

Status: dormant draft implementation and activation design for same-browser v2
booking. PR #197 now includes unseeded SQL buckets for `commit`, `cancel`, and
`acknowledge`; the route must consume them before any action RPC. No policy,
schedule, environment variable, or hosted state is activated. Action limits
still need owner approval. A signed cookie and exact intent UUID authorize an
operation, but do not limit how many times it can be attempted.

## Threat and safety boundary

The v2 route sends each valid signed-cookie action directly to its privileged
RPC. Each RPC resolves a tenant and takes a browser-session lock before it can
reject an arbitrary or foreign intent ID. A caller who owns one valid browser
cookie can therefore submit many invalid IDs or replay a valid ID and drive
database work and lock contention. A per-intent budget alone is bypassed by
changing the UUID. Shared-IP quotas alone could block unrelated visitors on a
salon or carrier network. The action budget must be independent of the
`reconcile` recovery budget.

## Draft contract

Before each action RPC, consume two separate, durable buckets atomically:

1. `action + tenant + browser`: bounds all action requests for one signed
   browser capability, including arbitrary intent IDs.
2. `action + tenant + browser + intent`: bounds repeated work for one exact
   intent. The intent UUID is validated for shape at the HTTP boundary but
   does not need a privileged read before budget consumption.

Use separate policy rows and counters for `commit`, `cancel`, and
`acknowledge`; exhausting one action must not consume another action's budget
or the `reconcile` budget. Resolve the canonical tenant ID inside PostgreSQL.
The trusted server supplies lowercase HMAC-SHA-256 digests, with domain
separation for the browser and intent scopes and a distinct server-only quota
key. Never store the raw cookie, IP, intent UUID, contact values, or an
attacker-supplied slug in the counter key. The database row may carry the
tenant ID and action. Preserve RLS, revoked anonymous/authenticated grants,
service-role-only `SECURITY INVOKER` execution, and an unseeded policy until
limits are approved.

Use transaction-scoped advisory locks in a deterministic order: browser bucket
then intent bucket. If combined with PR #197's IP bucket in a single function,
the complete order is IP, browser, intent. Check both capacities before
incrementing either; a denied intent bucket must not burn browser capacity.
Return only `allowed` and bounded `retry_after`, without counter values or
whether the intent exists. No in-process counter is durable across Vercel
instances. The draft extends PR #197, so the same bounded sweep and guarded
rollback cover these counters without a separate migration.

## HTTP and browser behavior

- Missing signing key, malformed trusted input, missing policy, or quota RPC
  error: return no-store `503 booking_unavailable` and do not call the action
  RPC. Never fall back to legacy booking.
- Exhausted bucket: return no-store `429 rate_limited` with a validated integer
  `Retry-After` within the approved window. Do not call the action RPC. Do not
  infer whether an appointment was committed from a quota denial.
- `commit` denial keeps the exact pending marker and immutable payload. The
  visitor must reconcile the same intent first. If it already committed,
  return the original confirmation without another `commit` call. Otherwise
  retry that exact intent only after the delay. Do not allow a changed booking
  attempt.
- `cancel` denial keeps the pending intent locked. Reconciliation remains
  available; a new attempt is allowed only after authoritative cancellation
  or definitive non-commit.
- `acknowledge` denial must not erase a confirmation or rotate the browser
  generation. Preserve the confirmed result and retry acknowledgement or
  reconciliation later, without silently unlocking another booking.

Allow these bounded existing-capability operations during a stale cleanup
signal, like `reconcile`, while `bootstrap` and new `prepare` continue to fail
closed. This recovery carve-out is viable only with short-lived cookies,
bounded counters, and an operational cleanup alert; missing action policy
still fails closed. The approved 24-hour cookie, 2-hour prepared intent, and
3-day terminal retention remain separate contracts, not quota defaults.

## Decisions and verification before activation

The owner must approve each action's browser and intent ceilings, window, and
expected `Retry-After` UX. Review shared-device retries, two-tab concurrency,
mobile network loss, and the risk of a compromised cookie exhausting its own
budget. The cleanup cadence, lag threshold, alerts, secret rotation, and free
plan firewall layer also need an operator plan. Do not seed limits or enable
the v2 flag from this document.

Required deterministic tests, with no live bookings or payments:

- Many different UUIDs under one cookie hit the same browser bucket, while
  valid intent replay hits both; a denied request never invokes an action RPC.
- Concurrent calls at a ceiling serialize and never exceed either bucket;
  denial in one bucket does not increment the other.
- Exhausting `commit` does not starve `cancel`, `acknowledge`, or `reconcile`.
  An immediate committed replay may be denied by the quota; reconciliation
  must still recover its original confirmation and one appointment.
- A denied `commit` can reconcile a committed result; denied `cancel` and
  `acknowledge` leave intent state and generation unchanged.
- Missing policy/key, stale cleanup, malformed IDs, wrong tenant, and
  anonymous/authenticated direct RPC calls fail as specified.
- Bounded sweep and guarded rollback cover action counter rows. Confirm the
  no-raw-key promise and no contact data in logs or HTTP errors.

Before any hosted SQL, run a fresh GlowFlow-only project identity, migration
ledger, and schema-fingerprint preflight and obtain separate approval. Code
merge, Preview readiness, or this design do not authorize migration or
activation. GLOW-56 stays In Progress until isolated QA and production
behavior prove the complete recovery contract.

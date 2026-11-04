# GLOW-56 dormant public-booking quota database track

This draft stacks on the unmerged private-intent cleanup migration. It creates
private RLS-protected policy, counter, and cleanup-state tables and two
service-role-only RPCs. It seeds no quota policy, installs no schedule, and
does not wire any route or feature flag. With no policy rows, consumption fails
closed. No hosted Supabase change is authorized by this draft.

The consumer resolves a salon slug inside PostgreSQL, accepts only 64-character
lowercase HMAC digests supplied by a future trusted server route, and stores no
raw IP, cookie, or contact value. Same-key requests take transaction-scoped
advisory locks in IP-then-browser order. They check both capacities before
incrementing either counter, so a full browser bucket cannot consume shared
IP capacity. A denied call returns only `allowed: false` and a bounded
`retry_after`; policy or cleanup failures raise and must map to unavailable,
never to permission for a new booking attempt. Rows expire within 24 hours.

`bootstrap` and `prepare` require a full quota sweep within two hours. The
bounded sweep handles 1–1000 expired rows per call and refreshes the signal
only after no expired rows remain. `reconcile` keeps its separately configured
recovery budget when cleanup is stale; the future API must preserve the exact
pending intent and changed-booking lock on 429 or 503. `commit`, `cancel`, and
`acknowledge` still need a separately reviewed, generous capability-scoped
abuse bound. Neither the counter maintenance schedule nor a failure alert is
installed here.

Disposable PostgreSQL tests cover RLS/grants, unseeded policy, stale cleanup,
tenant scope, browser-before-IP denial with no IP burn, concurrent calls at
the cap, bounded purge, and rollback refusal while policy or counters remain.
The rollback file is safe only with v2 disabled and no quota policy/counter
rows. The operator must separately verify that state before any rollback.

Before activation, review the HTTP trust boundary for Vercel-provided client
IP, server-only HMAC key and rotation, production ceilings for shared networks,
window-boundary bursts, route-level 429 recovery behavior, cleanup cadence and
alerts, and the free-plan firewall entitlement. A fresh GlowFlow-only hosted
identity/ledger/schema preflight and separate SQL approval are required. Do
not infer them from a passing local test or code merge.

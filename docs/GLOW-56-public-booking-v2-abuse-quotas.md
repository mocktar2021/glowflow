# GLOW-56 public booking v2 abuse-quota contract

Status: design only. This document creates no migration, API route, quota, firewall rule, policy row, worker, or booking-traffic change. The GLOW-56 v2 flag stays off. Implementation needs a separate reviewed migration and tests, a fresh GlowFlow-only hosted preflight, and separate approval before SQL or activation.

## Why a durable quota is needed

The public v2 `bootstrap` action can issue a new anonymous browser cookie without calling PostgreSQL. A cookie-only limit can therefore be evaded by obtaining another cookie. `prepare` stores short-lived contact data; `reconcile` and exact-intent recovery are also publicly reachable through a service-role server handler. A per-process memory counter is not shared across Vercel instances. The database must own the activation-critical limit, with platform DDoS mitigation as an additional layer.

## Minimum service contract

Add one private, RLS-enabled counter table and one `public.consume_public_booking_quota` wrapper executable only by `service_role`. Explicitly revoke `EXECUTE` from `PUBLIC`, `anon`, and `authenticated`; use `SECURITY INVOKER`, `search_path = ''`, and schema-qualified objects. The wrapper accepts an action (`bootstrap`, `prepare`, or `reconcile`), a server-derived opaque IP key, and, for non-bootstrap actions, a server-derived opaque browser key plus the public salon slug. Resolve the tenant inside PostgreSQL. It must never accept client-supplied limits, raw IPs, cookie tokens, contact fields, or a tenant ID selected by the browser.

The Next.js route derives the IP only from a trusted Vercel request source. Vercel documents that it overwrites `x-forwarded-for` rather than forwarding an external value; a local fixture must inject a trusted test IP explicitly. Normalize a single IPv4 or IPv6 address, then use a dedicated server-only secret to compute a domain-separated HMAC for the IP and browser token. Store only lowercase opaque digests. These digests are pseudonymous identifiers, not anonymous data, so apply the same access, retention, and logging safeguards as other personal data. Do not log the raw address, token, digest, or quota key. If a trusted IP or HMAC secret is unavailable, new `bootstrap` and `prepare` fail closed. Never trust a browser-provided forwarding header on a non-Vercel host.

The table's unique key is `(action_bucket, scope, key_digest, window_start)`, with `scope` distinguishing global-IP from browser-plus-tenant counters. Use fixed windows with an atomic `INSERT ... ON CONFLICT DO UPDATE` increment guarded by the applicable cap. A request that needs two buckets must either consume both or neither in one transaction. In particular, if a browser-plus-tenant bucket is exhausted, it must not burn the shared IP bucket and deny other visitors behind the same network. Return a bounded `Retry-After` for a denied action; a quota backend error is unavailable, never an allow decision. Counter rows should be purged in bounded batches after at most 24 hours, with an index on expiry; a stale cleanup signal must block new cookie issuance/preparation, not silently accumulate rows.

`bootstrap` must consume its global-IP quota before issuing a new cookie. An existing valid-cookie recovery path must not mint or rotate a cookie merely to bypass the bootstrap quota. `prepare` consumes both global-IP and browser-plus-tenant quotas before storing contact data. `reconcile` uses larger recovery budgets. Exact-intent `commit`, `cancel`, and `acknowledge` must remain available under a separately generous capability-scoped abuse bound; they must never be treated as definitively not committed because of a 429, timeout, or quota outage. Any throttled or unavailable response leaves the visitor's original intent marker and changed-booking lock intact. A returned `Retry-After` may guide a later same-intent retry, not authorize a new key.

For isolated QA only, start with generous candidate ceilings: `bootstrap` 60/minute/IP; `prepare` 6/10 minutes/browser+tenant and 30/10 minutes/IP; `reconcile` 30/minute/browser+tenant and 120/minute/IP. These are not approved production policy values. Shared networks can contain many legitimate visitors; IP rotation can evade an IP-only limit. Tune against real non-sensitive aggregate traffic and test a window-boundary burst before approval. A global tenant-wide hard cap could let an attacker block every genuine visitor to one salon, so it is not part of this minimum contract.

## Platform layer and free-capacity boundary

Vercel documents automatic DDoS mitigation on Hobby at no setup cost. Its WAF can rate-limit by IP, but counters are per region and rule availability for this team's free plan has not been confirmed. Treat a path-and-method-scoped WAF rule as optional coarse protection, not the authoritative v2 quota. If available, stage log-only first, review legitimate traffic and Preview behavior, and require an explicit owner publish decision before any production throttle. Do not upgrade, change billing, publish a firewall rule, or add an external paid rate-limit store to implement this design.

## Tests before activation

- Concurrent calls at the exact limit admit no more than the cap, and a failed second bucket rolls back the first bucket's increment.
- A no-cookie client cannot mint unlimited sessions; a new cookie cannot evade the IP bucket. Tenant/browser buckets isolate salons without leaking whether an intent exists.
- Missing, malformed, or spoofed client-IP context and missing HMAC configuration fail closed for new bootstrap/preparation; no raw identifiers appear in database rows, responses, URLs, or diagnostics.
- Window-boundary bursts, shared-IP load, IPv4/IPv6 normalization, counter expiry, and bounded purge are exercised with a disposable local PostgreSQL instance.
- A 429 or quota failure during ambiguous recovery preserves the original marker and changed-booking lock in FR/EN/ES. Existing intent commit/cancel/acknowledge remains safe under an overloaded bootstrap/prepare bucket.
- The v1 arbitrary-key route remains fenced at cutover, and no quota decision can cause a fallback to v1 or a new request key.

## Sources and open decisions

Current Vercel request-header documentation says `x-forwarded-for` is overwritten to prevent client spoofing; Vercel Firewall documentation says DDoS mitigation is free on Hobby and WAF rate counters are regional. Supabase Cron documentation describes scheduled PostgreSQL jobs; the existing GLOW-56 cleanup draft does **not** install one. The Supabase changelog endpoint returned 403 from this workspace, so current implementation details must be rechecked with provider docs before a migration is written.

Owner/operator decisions still needed: approved production ceilings after a log-only traffic sample, HMAC secret ownership/rotation, quota-counter cleanup cadence and alerting, and whether this team's free Vercel plan exposes custom WAF rate-limit rules. None of these choices authorizes hosted SQL or traffic activation.

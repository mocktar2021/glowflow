# GLOW-56 temporary Preview forwarded-header diagnostic

This draft adds only a read-only GET at
`/api/public-booking/v2/forwarded-header-diagnostic`. It is disabled by default
and returns 404 unless `VERCEL_ENV=preview`,
`GLOWFLOW_PUBLIC_BOOKING_HEADER_DIAGNOSTIC_ENABLED=true`, and the public booking
v2 gate is off. It does not connect to Supabase, create a booking, or enable v2.
Both enabled and disabled responses are `private, no-store`.

When explicitly enabled on a protected GlowFlow Preview, the response contains
only `has_forwarded_ip`, `single_valid_ip`, `vercel_copy_matches`, and
`forwarded_ip_matches_qa_sentinel` booleans. The fourth compares the
server-observed `x-forwarded-for` with one fixed RFC 5737 test address,
`203.0.113.77`; no request header, query parameter, cookie, or body can choose
the comparison value. It detects a valid-IP spoof that the first three shape
booleans alone would not reveal.
It never returns or logs an IP address, cookie, token, digest, or secret. The
shape check shares the quota adapter's canonical IP parser, but a local test
cannot establish whether Vercel overwrites a visitor-supplied forwarding
header. `vercel_copy_matches` is false when Vercel supplies no copy header;
these are diagnostic observations, not an authorization decision.

After separate review on a protected Preview, use only read-only GETs: first
an ordinary request, then a request with a forged valid
`x-forwarded-for: 203.0.113.77`, then one with **both**
`x-forwarded-for: 203.0.113.77` and
`x-vercel-forwarded-for: 203.0.113.77`. The sentinel boolean should remain
false for all three if the platform replaces visitor-supplied forwarding
headers. If it is true on either forged request, stop: the quota adapter's IP
trust assumption is unverified and v2 must stay off. Do not send a booking
POST, turn on v2, pass a candidate IP in the URL, or record raw headers,
cookies, bypass credentials, or response traces during this check.

Remove this temporary route and its diagnostic flag before any production
merge. Do not configure the flag on Production, deploy v2, or treat the
diagnostic result as proof of database isolation or booking safety.

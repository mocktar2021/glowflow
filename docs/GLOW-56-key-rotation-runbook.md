# GLOW-56 booking-key rotation and recovery-only drain (draft)

This is an operations design, not approval to enable booking v2, edit Vercel
settings, rotate secrets, or change Supabase. Booking v2 remains off. The code
has **one** cookie signing key and **one** quota HMAC key, with no previous-key
validation. Do not describe a live rotation as seamless.

## Boundaries to verify before any future operation

- `GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY` is a server-only, canonical
  base64url encoding of 32 nonzero bytes. It signs the issuing host and cookie
  payload. The `__Host-` cookie is Secure, HttpOnly, SameSite=Strict, host-only,
  and has an explicit lifetime of 300 to 86,400 seconds. The server hashes the
  **entire signed cookie** to find its browser intent. Re-signing or replacing
  a cookie changes that hash and cannot transparently recover its old intent.
  See [cookie validation and issuance](../app/api/public-booking/v2/route.ts)
  and the [zero-key and drain tests](../tests/public-booking-v2.test.mjs).
- `GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY` is a separate server-only, canonical
  base64url encoding of 32 nonzero bytes. It derives domain-separated IP,
  browser, and browser-plus-intent digests. Replacing it creates new quota
  bucket identities; the old counters do not carry over. Missing or invalid
  quota keys block quota-protected actions, including reconciliation, commit,
  cancel, and acknowledgement; existing-cookie bootstrap alone can still
  return ready. See
  [quota key construction](../lib/public-booking-quota-keys.ts) and
  [quota-before-intent ordering](../app/api/public-booking/v2/route.ts).
- Generate independent high-entropy values for these two purposes and for each
  environment. The route and quota adapter fail closed when the two configured
  values are identical; this guard does not prove independent generation or
  separation between environments. Format and nonzero checks do not prove entropy. Never use a
  `NEXT_PUBLIC_` variable, copy a key between QA and Production, print a key,
  put it in an issue, or include it in a diagnostic response or log. Review
  secret *presence and scope*, not values, during preflight.
- Verify the exact Vercel team, project, deployment target, aliases, and
  Supabase project reference for each environment. The present
  `glowflow.mocktar.com` QA path can be a Vercel **Production** deployment;
  `VERCEL_ENV=production` is not proof that it is the future product Production
  at `glowflow.beauty`. Require separate hosts, secrets, and Supabase projects.
  Host-bound signatures stop a copied QA cookie on another host, but do not
  isolate database rows, service-role access, or HMAC digests if infrastructure
  is shared. No Production project identity is assumed by this draft.

## Planned, non-compromise rotation

Only an owner-approved change window with a staffed support path may use this
sequence. Stop if the identity, alias, key-scope metadata, reviewed code, or
database readiness differs from the approved preflight.

1. Before changing anything, verify the v2 gate, the current and intended
   aliases, deployed commit, and the separate database target. Check that
   intent and quota policy, cleanup, and monitoring are actually active and
   healthy if v2 has ever been enabled. Retain the old signing and HMAC keys.
   Record the last time an old deployment could issue a cookie, without
   recording any cookie, address, digest, or key.
2. Pause **new** issuance and preparation by removing the configured
   `GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_MAX_AGE_SECONDS` from the target release.
   Keep `GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED=true` and both old keys unchanged.
   This is a controlled booking interruption, not an invisible maintenance
   mode: the current page may still show a form, but a new attempt returns
   unavailable. Communicate that limitation. Without Max-Age, no-cookie
   bootstrap and every prepare fail 503, while an existing valid cookie can
   bootstrap without reissuance and can reconcile, commit, cancel, or
   acknowledge its original intent. The local unit test covers this matrix.
   See [v2 route](../app/api/public-booking/v2/route.ts).
3. Verify every serving deployment and alias has the paused configuration.
   Old deployment URLs, Preview aliases, or propagation overlap must not keep
   issuing old-key cookies. Start the drain clock only after the **last
   possible old-key issuance** and alias propagation are accounted for. Keep
   both old keys usable throughout the drain. Wait at least 24 hours from
   that point, not merely from the first configuration edit. This covers the
   maximum accepted signed-cookie lifetime; it does not prove physical
   deletion of intent records or quota counters.
4. With issuance still paused, install fresh, distinct signing and HMAC keys
   in the verified target environment through a separately approved secret
   procedure. Do not use an old-key grace period: this code has no key ring.
   Allow the key change to converge on all serving deployments before
   restoring Max-Age. A rolling mix of old and new HMAC keys splits quota
   accounting; a rolling mix of signing keys rejects the other deployment's
   cookies. Rotation does not delete old quota counters; their policy window
   and physical cleanup must be verified separately.
5. Restore the approved Max-Age only after the alias, deployment, and
   environment scopes are stable, read-only checks pass, and the owner
   authorizes resuming new bookings. Keep the v2 cutover rule intact. Turning
   v2 off reopens the legacy arbitrary-request-key booking POST; it is **not**
   a safe rotation switch. See [legacy POST guard](../app/api/public-booking/route.ts)
   and [v2 gate](../lib/public-booking-v2-config.ts).

## Verification and rollback gates

- Before and after each release boundary, compare deployment IDs, exact commit,
  target environment, and domain alias using platform metadata. Check secret
  presence/scope without fetching or logging values. Use only safe public GETs
  and aggregate runtime error counts for hosted smoke checks. Do not send a
  live booking, payment, commit, cancel, or acknowledgement to test rotation.
  Any hosted database aggregate/catalog query needs its own scoped approval.
- The code-only tests prove the paused route contract and legacy 410 guard;
  they do **not** prove Vercel propagation, browser-cookie continuity, hosted
  database identity, or a live booking. If those facts cannot be established
  read-only, stop and request an approved synthetic QA verification plan.
- Before keys change, rollback of the pause means restoring the prior approved
  Max-Age while keeping the same keys, only after rechecking identity and
  getting approval to resume bookings. If unsure, remain paused.
- After keys change but **before** any new cookie can be issued, restore the
  old pair only if neither key is compromised and the operator can prove no
  new-key cookie was issued. Keep issuance paused while verifying. If that
  proof is missing, stop; do not silently invalidate a second cohort.
- After new issuance resumes, never roll keys backward blindly. New cookies
  depend on the new signer and quota counters on the new HMAC key. Use a new
  reviewed drain or a separately designed dual-key migration. No dual-key
  support exists here.

## Emergency compromise

Do not wait 24 hours or accept a compromised signer as a previous key. Freeze
new issuance/preparation while keeping the v2 gate on and legacy POST blocked;
replace the compromised secret under incident authority. A signing-key
replacement immediately invalidates outstanding cookies, so exact-intent
recovery may require manual salon support and authoritative appointment
lookup. A quota-key replacement resets effective limits and may require
additional abuse controls. Preserve only non-sensitive incident evidence,
notify affected operators, and do not claim that pending bookings are canceled
or unbooked until the database outcome is verified. This emergency path is an
availability tradeoff, not the planned rotation path.

# GLOW-56 original GitHub service-key cleanup draft (superseded)

The original code-only PR #224 proposed a GitHub Actions job holding a full
GlowFlow Supabase service-role key and a Healthchecks bearer URL. The owner
subsequently confirmed there is no separate repository reviewer and did not
approve storing that key in unattended GitHub Actions. **Do not add that
secret or use the old repository ACK** `enable-glow56-qa-cleanup-20261105`.

The workflow has been changed in a later candidate to request short-lived
GitHub OIDC identity and call a protected QA Vercel route instead. Its new
ACK differs from the old value, and the route has a second off-by-default
activation value. See the current [no-key candidate and its hosted gates](GLOW-56-github-oidc-cleanup-candidate.md).

The shared Supabase project `rfwhqutkiztxkagbhevp` is **not** isolated QA.
No hosted job, secret, migration, Healthchecks signal, or booking-v2 switch
is authorized by either document. Keep the database's two-hour freshness
fence fail-closed and obtain separate approval before any activation.

Historical evidence and the original proposal remain recoverable in git at
commit `e53701510030db033155190b759858ad2b0f9d60`.

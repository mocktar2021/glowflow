# GLOW-9 verified staff invitation contract (inactive)

This branch defines a database acceptance boundary only. It does not create or send invitations, change Supabase Auth settings, expose a staff UI, or route a recipient through login. A code merge does not authorize applying SQL to hosted GlowFlow.

## Security contract

- The MVP remains one salon per login. `public.users.id` is the unique membership key. An already-linked recipient, including someone already in the same salon, is rejected without moving or promoting the account.
- `private.staff_invitations` has RLS and no direct client or service-role grants. It stores a SHA-256 token digest, never the reusable plaintext token. It records tenant, inviter, normalized target email, issue and expiry times, revocation, and acceptance evidence.
- There is intentionally no issuance function. A later reviewed owner-only issuer must generate 32 cryptographically random bytes, encode them as unpadded base64url, store only the digest, derive the tenant from the owner's authenticated membership, choose the expiry, and separately manage sending and abuse limits. No recipient lookup should be disclosed to an inviter.
- `public.accept_staff_invitation` is the only staff-membership creation path added here. It is callable by an authenticated recipient with a token, name, and FR/EN/ES locale. It derives identity from `auth.uid()`, locks the invitation and Auth identity, checks the current Auth-confirmed email against the intended address, locks the tenant and owner membership, inserts a staff row for that exact identity and tenant, and marks the invitation accepted in one transaction. Every invalid case returns the same error. The earlier direct owner-to-staff INSERT guard remains in place.
- Token redemption must be initiated only after sign-in or email verification. A later recipient route must avoid the generic owner-onboarding callback and strip the token fragment before navigation or logging. A raw token must not enter server access logs, analytics, error messages, or durable browser storage.

## Tests and rollout

The local PostgreSQL security suite uses synthetic Auth identities and invitations. It checks role grants, owner bypass attempts, unverified and mismatched emails, expired and revoked tokens, unknown tokens, replay, existing memberships, simultaneous redemption, and fail-closed rollback. It does not simulate live Supabase Auth email delivery or browser PKCE handling.

Before any hosted migration, independently verify the exact GlowFlow project identity, migration ledger and fingerprints, current grants/RLS, Auth schema compatibility, and the earlier GLOW-9 direct-insert guard. Obtain separate hosted-SQL approval. No `db push`. Before activation, separately review the issuance endpoint, rate limits, sender/template, expiry/resend policy, existing-account messaging, and recipient auth flow. Test new and existing accounts with explicitly approved disposable identities.

The operational rollback revokes acceptance execution, retaining invitation audit rows and accepted memberships. It does not reopen arbitrary owner insertion. Re-enabling requires a reviewed forward change.

GLOW-9 remains In Progress until the full invitation flow, password recovery and email verification are live-verified.

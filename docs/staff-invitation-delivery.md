# GLOW-9 invitation delivery contract (inactive)

This change prepares the server-side handoff for staff invitations. It does **not** send email, expose an owner invitation action, start a worker, or apply a hosted migration. The issuance flag defaults to off. GLOW-9 remains in progress until the sender, live database migration, and signed-in owner/recipient acceptance are separately reviewed.

## Boundaries

- `enqueue_staff_invitation_delivery` is callable only by the service role. The server wrapper gets the current Auth user, requires a confirmed address, and passes that user ID to the RPC. PostgreSQL rechecks that the ID is the verified owner of exactly the chosen tenant. No browser token or tenant ID selects a tenant.
- PostgreSQL serializes requests against the tenant row. A stable request UUID is idempotent. A different request for a recipient with an open delivery returns the same delivery ID without producing another token. Limits are three queued attempts per recipient per salon per hour and 20 per owner per day, counting failed sends too.
- The 43-character invitation token is returned only to a future trusted sender through a service-role claim. The invitation table holds only its SHA-256 digest. The private outbox holds AES-256 ciphertext and has RLS with no direct application-role table grants. The encryption passphrase is a server secret and must not appear in logs or browser bundles.
- A previous usable invitation is not revoked merely because a replacement was queued. A definite provider failure invalidates only the unsent replacement. A confirmed provider acknowledgement revokes prior unaccepted links for the same recipient and salon. An unknown provider result stays `uncertain` for manual reconciliation; it must not be blindly resent.
- A future sender must use the claim's stable idempotency key with a provider that supports idempotent send semantics, classify acknowledgements carefully, then call `settle_staff_invitation_delivery`. A two-minute claim lease and bounded retry count prevent a hot loop, but cannot alone prove whether a timed-out provider call delivered. Do not enable a sender until its timeout/reconciliation behavior and alerting are reviewed.

## Activation checklist (separate work)

1. Review and explicitly approve the exact migration and fresh GlowFlow-only Supabase preflight before applying SQL. This PR does not apply it.
2. Choose a transactional email provider, free-tier capacity, verified sending domain/address, and privacy/retention policy. No payment or provider activation is part of this PR.
3. Build and review a server-only sender that uses a secret 32–256-byte `GLOWFLOW_INVITE_OUTBOX_KEY`, treats the idempotency key as stable, never logs tokens or addresses, and has explicit reconciliation for `uncertain` outcomes.
4. Add owner UI/action with abuse controls and generic responses, then enable `GLOWFLOW_STAFF_INVITE_ISSUANCE_ENABLED=true` only after database, sender, and live end-to-end checks pass. Default remains `false`.
5. If issuance must be halted, apply the narrowly scoped rollback to revoke the three delivery RPC grants. It retains outbox and invitation audit rows; it does not delete data.

# GLOW-9 inactive invitation preparation

The owner approved a 48-hour invitation expiry and a resend rule that revokes
the previous unaccepted token for the same salon and normalized email. This
code-only draft does not send email, expose an owner action or recipient route,
or apply SQL to hosted Supabase.

`private.prepare_staff_invitation` derives the salon from the authenticated
owner's current membership. It locks pending invitations before the owner and
tenant to match acceptance's lock order, rechecks ownership, then revokes any
unaccepted unrevoked tokens for the same salon/email and generates 32 random
bytes and stores only the SHA-256 digest of its unpadded base64url token. The
new row's `created_at` and `expires_at` are exactly 48 hours apart. Resend is
atomic: a failure to insert the replacement rolls back the revocation. Old
accepted invitations remain in the audit history.

The function is in `private` with no `anon`, `authenticated`, or `service_role`
EXECUTE grant. No app route, sender, or UI calls it. No plaintext token is
stored in a persistent table. Synthetic local tests may retain a token only
inside a disposable temporary table.

Before activation, review an owner-only server wrapper, per-owner and
per-recipient abuse limits, sender/template, existing-account messaging,
recipient sign-in/verification route, and safe response/logging behavior. Do
not expose a raw token to the browser or log it. Do not use Supabase Auth's
`inviteUserByEmail` as a passive reservation; it sends immediately. Obtain
separate approval and repeat a fresh hosted migration preflight before applying
this SQL. The rollback drops only this inactive function, preserving invitation
history and the existing acceptance boundary.

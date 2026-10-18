# GLOW-9 staff invitation feasibility and security contract

Status: design evidence only. No invitation, acceptance, email, or membership-creation path is enabled by this document or its regression tests. GLOW-9 remains In Progress.

## Current contract

- `public.users.id` is both the primary key and a foreign key to `auth.users.id`, so one Auth identity can currently belong to only one salon. `public.users.tenant_id` is the sole membership link.
- Owners and staff can read members of their own tenant through RLS. `users_owner_or_self_insert` permits an owner to insert a staff membership in their tenant for an existing Auth user ID. It checks the owner's tenant, but does not prove that the person accepted an invitation or that the inserted email matches a verified Auth email. An owner who knows an unattached Auth user ID could attach that identity without consent. Staff and unrelated owners do not have this permission.
- The existing `create_owner_workspace` function returns an existing member's tenant, otherwise creates an owner tenant. The generic `/auth/callback` calls it after every successful PKCE exchange. A new staff invite link sent through this callback would therefore reach owner onboarding unless a separately reviewed acceptance path is introduced.
- The application has no staff-invitation action, invite table, invite acceptance route, or use of `auth.admin.inviteUserByEmail`. The [Supabase API](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail) sends an email immediately, so it is not a passive way to reserve membership.
- `tests/schema-authorization.sql` now checks that staff, a foreign owner, and an unaffiliated user cannot create a membership in the wrong context. These tests do not establish verified email, consent, token security, or a live invitation flow. The local platform fixture also does not simulate real Auth email delivery or JWT verification.

## Contract required before activation

1. Only an authenticated tenant owner may create, revoke, or view invitations for that tenant. The server must derive `tenant_id` from the owner's current membership, not a form field. Staff, anonymous users, and owners of other tenants must fail closed. A service-role client bypasses RLS, so any endpoint using one must perform this check before privileged work.
2. Invites must target the staff role only. Normalize and validate the email address, avoid revealing whether it already has an account, rate-limit creation and resends, and record inviter, tenant, creation, expiry, redemption, and revocation for audit. No plaintext reusable secret belongs in the database, logs, URLs retained in analytics, or error messages. Use an unpredictable single-use token and store only its hash.
3. Acceptance must happen in one database transaction after the recipient has authenticated. Bind the token to the intended tenant and to an Auth-verified email on the authenticated user. Do not trust `user_metadata`, a submitted email, `next`, or a caller-supplied user ID as proof of identity. Recheck expiry, revocation, token reuse, owner/tenant existence, and existing membership while holding the required lock. A replay, email mismatch, cross-tenant attempt, or second membership must create no `public.users` row.
4. Replace or constrain direct owner insertion of arbitrary staff rows when the acceptance path is introduced. The verified acceptance operation should be the only way to create staff membership. Preserve the first-owner onboarding path and existing staff records during rollout; cover owner, staff, unrelated owner, unaffiliated, and anonymous roles in real PostgreSQL RLS tests.
5. Route invitation confirmation separately from owner onboarding. Preserve the current same-origin callback redirect guard. The acceptance route must not create a tenant for the invitee, must not grant owner privileges, and must redirect to an appropriate FR/EN/ES sign-in or workspace page on failure without leaking private tenant details.
6. Test no-email local acceptance with synthetic tokens and verified Auth fixtures first. Before enabling mail, verify real Supabase Auth behavior and hosted configuration for both new and existing accounts, then run an explicitly approved disposable cross-tenant invitation test with cleanup. Do not infer live delivery from an admin-provisioned owner test.

## Product decisions needed

- Is the one-salon-per-person rule intentional? If a person may work in multiple salons, the current primary key and membership model need a larger design change before invitations.
- What should happen when the invited address already has a GlowFlow account or is a member of another salon? Do not silently move or duplicate membership under the current model.
- Which sender, template, rate limits, and verification route should deliver invitation email? This needs a reviewed operational choice and test account. No invite email should be sent as part of this feasibility audit.

There is no hosted SQL, Auth configuration change, invitation send, migration, or activation step in this slice.

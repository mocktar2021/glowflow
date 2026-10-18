# GLOW-10 production domain verification and rollback

`glowflow.mocktar.com` is the GlowFlow production hostname on the Vercel
`glowflow` project in team `tairoumocktar-9966s-projects`. The production
branch is `master`. Keep domain, application and database changes separate:
this runbook does not authorize DNS edits, deployment promotion or database
rollback.

## Read-only release check

1. In Vercel, confirm `mocktar.com` is owned and verified by the intended team.
   Confirm `glowflow.mocktar.com` is verified on project `glowflow`, with no
   configuration conflict. Check that its DNS configuration is not marked
   misconfigured. The DNS provider is external, so a Vercel DNS record list
   alone is not authoritative for this hostname.
2. Confirm the hostname's certificate is valid for
   `glowflow.mocktar.com` and HTTPS requests validate normally. Confirm the
   hostname alias points to a `READY` production deployment built from the
   intended `master` commit. Record the deployment ID, commit and time.
3. From a network permitted to reach the public domain, make GET requests
   without sending booking or payment POSTs. Inspect both status and
   `Location` on redirects. Do not use `-k` or otherwise disable TLS checks.

   ```bash
   curl -sS -o /dev/null -D - --max-redirs 0 https://glowflow.mocktar.com/
   curl -sS -o /dev/null -D - --max-redirs 0 https://glowflow.mocktar.com/fr/salons
   curl -sS -o /dev/null -D - --max-redirs 0 https://glowflow.mocktar.com/fr/dashboard
   curl -sS -o /dev/null -D - --max-redirs 0 https://glowflow.mocktar.com/fr/login
   curl -sS -o /dev/null -D - --max-redirs 0 https://glowflow.mocktar.com/fr/book/PUBLISHED_SALON_SLUG
   ```

   Root should redirect to `/fr/salons`, which should return 200. For an
   anonymous visitor, `/fr/dashboard` should redirect to `/fr/login`, and
   `/fr/login` should return 200. In an already authenticated owner session,
   `/fr/dashboard` should render successfully. Replace
   `PUBLISHED_SALON_SLUG` with a salon that the owner has deliberately
   published and enabled for booking; its booking page should return 200.
   A draft salon's 404 is expected but does not satisfy the successful
   booking-route criterion. Verify a second supported locale as a routing
   cross-check. Never create an appointment during this check.
4. Record the results and deployment link in GLOW-10. Keep the issue open if
   any current-deployment route response or TLS handshake is unverified.

## Application rollback during an incident

Only the incident owner should approve a production rollback. Record the
current alias, deployment ID and commit before changing anything. In the
Vercel `glowflow` project, identify the last *known-good* `READY` production
deployment and check that it is compatible with the current database schema,
environment variables and external integrations. Do not assume the immediately
previous build is healthy.

Use Vercel's rollback control or this command to reassign the production alias:

```bash
vercel rollback <known-good-deployment-url> --scope tairoumocktar-9966s-projects
```

Then repeat the read-only checks above and record the new alias and deployment ID.
Vercel rollback disables automatic domain assignment for later production
pushes. After the fix is verified, explicitly promote the intended healthy
production deployment and confirm automatic assignment is restored before
resuming the ordinary release flow.

Application rollback does not reverse a Supabase migration, stored booking,
payment, Auth or Storage change. Investigate those separately under their own
runbooks and approval. Do not replay the migration directory or run `db push`
as part of a domain or application rollback.

## October 18, 2026 audit snapshot

Vercel reported `mocktar.com` team ownership verified and the project domain
`glowflow.mocktar.com` verified. Its domain configuration reported the
external-DNS CNAME `bb29cf251e09ffaa.vercel-dns-017.com.`, no conflicts and
`misconfigured: false`. Auto-renewing certificate
`cert_HgeqARUhXPMbDhQEzAxbNTLw` covers the exact hostname. The alias pointed
to `READY` production deployment `dpl_BcrwFEiDedw4vH9Mf3aDe2XGtENV`, built
from `master` commit `90b7fda4876e14994ce3a73091658911581e60bd`.

These control-plane checks do not prove a current end-user TLS handshake or
route response. The audit executor's enforced outbound policy did not permit
GET requests to `glowflow.mocktar.com`, so the root, dashboard and booking
route checks above remain to be repeated from an allowed network against
that exact deployment. A prior GLOW-10 Jira comment records French root,
dashboard and HTTPS evidence on an older deployment. It also records a draft
salon booking 404, which is not a successful booking-route check.

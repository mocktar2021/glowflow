---
name: glowflow
description: Deliver, review, plan, or operate the GlowFlow salon SaaS and public marketplace across its Next.js, Supabase, Vercel, Stripe, GitHub, and Jira workflows.
---

# GlowFlow

Use this skill for every task in the GlowFlow repository or GLOW Jira project.

## Product boundary

Treat GlowFlow as two connected products:

1. A private multi-tenant workspace for salon owners and staff.
2. A public multi-country marketplace for salon search, profiles, products, availability, and booking.

Preserve the GlowFlow cream, dark-slate, and rose-gold identity. Use competitor products only as research. Do not copy their text, artwork, branding, or layouts.

## Required product rules

- Support French, English, and Spanish in user-facing interfaces. French stays the default until the product owner changes it.
- Keep language separate from operating country. Model country, currency, time zone, address format, taxes, payment methods, and market availability independently.
- Support cash, card, deposit plus cash balance, and mixed checkout where the salon and country configuration allow them.
- Keep public marketplace fields separate from private tenant records. Salon owners control publication.
- Make booking conflict protection authoritative in PostgreSQL transactions or constraints.
- Design public flows for mobile use, accessibility, localized SEO, and low-latency rendering.

## Architecture

- Use Next.js App Router and TypeScript on Vercel.
- Use Supabase Auth, PostgreSQL, Storage, and Row Level Security.
- Prefer standard PostgreSQL, versioned migrations, and portable service boundaries.
- Use PostGIS for location queries and PostgreSQL full-text search during the initial marketplace stage.
- Keep long-running notifications, retries, indexing, and other jobs outside request-response functions.
- Use Stripe Connect only in supported markets. Route payments through country configuration instead of hard-coded provider assumptions.
- Never expose service-role keys or private tenant data to the browser.

## Delivery workflow

1. Read the relevant Jira issue and inspect existing repository work before changing code.
2. Search the GLOW project for related work. Update an existing issue when one already covers the request. Otherwise create the smallest useful story with concrete acceptance criteria.
3. Keep the active issue in progress only while implementation is active.
4. Create a branch named with the Jira key. Include the key in commits and the pull-request title.
5. Preserve unrelated user changes. Never write directly to the default branch.
6. Run relevant lint, type, unit, integration, migration, RLS, and end-to-end checks.
7. Open a pull request with scope, tests, risks, migration steps, deployment impact, and Jira linkage.
8. Do not merge without the product owner's approval.
9. After merge, verify the Vercel production deployment and the affected flows on glowflow.mocktar.com.
10. Mark Jira Done only after required checks and production verification pass. Add links to the pull request and deployment evidence.

## Security and data

- Every tenant-owned table must enable Row Level Security.
- Test owner, staff, anonymous, and cross-tenant access paths.
- Public anonymous policies must expose an explicit allowlist of published fields.
- Store secrets in platform environment variables. Keep secrets, personal data, and payment data out of logs and source control.
- Require idempotency and signature verification for payment webhooks and retried jobs.
- Use reversible database migrations and document any required backfill.

## Definition of done

Work is complete only when code, tests, migrations, documentation, Jira state, pull-request state, and deployed behavior agree. Report anything not independently verified.

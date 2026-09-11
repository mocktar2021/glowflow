# GLOW-28 / GLOW-42 delivery wave

Base: PR 31 merge 5275dadf007b4d6d8da882959adc4102de2f5287. Its tree matches tested PR head 791421f. Production deployment dpl_5yyCiiDKPyh2GbxFCyxwute31EiL reached READY and is aliased to glowflow.mocktar.com. Production login and FR/EN/ES marketplace smoke requests returned 200; checkout remained 503 as configured. Broader GLOW-25/35/37 acceptance gaps remain open.

## Scope

GLOW-28 adds validated plain-text confirmation, 24-hour and 2-hour templates in French, English and Spanish, client-locale fallback through salon locale to French, and an owner-only preview using fictitious samples. Provider delivery, scheduling, consent enforcement and activation belong to GLOW-26/27/29 and are not included.

GLOW-42 carries the selected service from a published salon profile into the existing booking route. Service identifiers must resolve to the selected salon's active trusted catalog; invalid or foreign identifiers fail closed. The existing sandbox and conflict safeguards remain authoritative. Required online deposits, full confirmation policy information and analytics remain broader acceptance gates.

No shared database migrations, payment activation, provider credentials, outgoing client messages or subscription changes are included.

## Verification

Application revision 56637a9 passed the production build and TypeScript checks. The Node suite passed 103 of 104 tests with no failures; the optional local database test was skipped and remains covered by the dedicated PostgreSQL CI job. All 16 browser scenarios passed using the documented bundled Playwright/installed Chrome override. Lint passed with zero errors and two existing calendar warnings after excluding generated browser-fixture build files. No authenticated deployed owner-preview session or actual message delivery is claimed. Final commit CI and preview checks follow publication.

# GLOW-42 confirmation details and GLOW-35 authenticated journey checks

This wave continues from merged PR32 (`15e4ccd6c1e1b117ae9cc5afbfc33bd58fc61659`).

## Scope

Successful public bookings now show salon identity, salon-local appointment time, published address and salon policies, and the current catalog price with an explicit currency code. The page explains that this booking collected no online payment. Prices are labeled as current catalog prices because appointments do not yet persist an agreed-price snapshot. Missing public details have localized contact-the-salon guidance; optional enrichment failure must not turn a committed booking into an error.

The API derives details from the persisted appointment bound to its tenant and request key. Only published profile fields are eligible. It does not accept client-supplied prices, addresses or policies. No schema or payment configuration changes are required.

## Verification scope

Browser coverage adds FR/EN/ES confirmation rendering and recovery from a mocked unavailable slot. A separate fixture imports the production notification page and authentication guard into Next.js and substitutes only the Supabase SDK adapter. It checks fictitious owner access, cookie removal, anonymous/staff/cross-tenant rejection and query failures across all three locales.

The browser fixtures do not prove live Supabase sessions, database conflict transactions, Stripe settlement or deployed owner access. Existing RLS CI remains separate. Production verification follows owner-approved merge. GLOW-42 and GLOW-35 remain open for their broader acceptance criteria.

Review also caught a legacy RPC replay edge: when stored-service enrichment is unavailable, its returned service title can describe a modified retry instead of the saved appointment. The confirmation therefore shows explicit unavailable guidance until stored-service details are verified. Catalog currency display is limited to the configured EUR/USD markets; other currencies require their own amount-unit contract.

Validation results will be recorded after the integrated checks finish.

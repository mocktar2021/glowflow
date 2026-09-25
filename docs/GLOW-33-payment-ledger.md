# GLOW-33 immutable payment ledger

GlowFlow now has an append-only source of truth for appointment payments and refunds. Each entry stores a positive amount in minor currency units; `entry_type` determines whether it adds to or subtracts from the appointment balance. Cash, connected-account Stripe charges, and card-terminal payments are recorded independently, so mixed tender is represented by multiple entries rather than a mutable total.

Only a salon owner may insert a manual entry. Staff can read their tenant ledger but cannot insert, update, or delete entries. Anonymous, unaffiliated, and cross-tenant access is denied. Provider code can insert through the service role after it has independently verified a signed webhook. Provider references and tenant idempotency keys prevent duplicate entries. Concurrent refunds serialize on the appointment and cannot exceed recorded payments. Currency must match the tenant currency.

The migration does not modify the existing owner-only Stripe sandbox, create live charges, issue receipts, or infer cancellation/refund/tax rules. These product and operations decisions remain required:

- which staff roles may record cash or external-card tender;
- the cancellation deadline, refundable percentage, and no-show policy;
- required receipt numbering, legal identity, and tax fields for each market;
- the exact provider event mapping for live connected-account charges and refunds.

Production application requires a separately reviewed targeted migration. Do not run an unrestricted `supabase db push` while the remote migration ledger differs from repository filenames.

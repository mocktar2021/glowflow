# GLOW-46 public search sorting rollout

## Scope

The new `search_public_salons_sorted` RPC sorts published salons before pagination
by price or next availability. Price sorting requires one country so prices are
compared in the same currency. The existing `search_public_salons` RPC remains the
default relevance path. No table, stored row, Auth, or Storage change is required.
No backfill is needed. The UI shows an explicit relevance fallback if the new RPC
is not yet available.

## Production preflight and apply

This PR does not apply SQL to a hosted project. Any later production application
requires separate product-owner approval. The only intended target is Supabase
organization `goutxcrujaxjjssbjfsn`, project `rfwhqutkiztxkagbhevp` (GlowFlow).
Do not touch MowFlow. Do not use `supabase db push` or replay historical migrations.

Before applying, confirm the reviewed PR commit and the migration fingerprint
`ec836a9ff632735fc285c91d26bb28813e6469085d53aba715069e7adbb5f27b`.
Require the remote history to match the first 33 entries of
`supabase/migration-history-map.json` exactly, ending with
`20261017174506_optional_product_translations`, and require the sorted RPC to be
absent. Stop if identity, ledger, fingerprint, or function state differs.

Apply only `supabase/migrations/20261017220612_add_public_salon_sorting.sql` once
through the reviewed Supabase migration operation. Record its remote history row.
If that operation assigns a generated version, verify exactly one new row named
`add_public_salon_sorting` and then reconcile migration metadata only so the final
remote version is `20261017220612`, with no generated alias left. Stop on any
unexpected row or function definition. Do not re-run the SQL to fix a ledger issue.

After application, verify the new function is `SECURITY INVOKER`, has only the
reviewed public result columns, and is callable by `anon` and `authenticated`.
With published test salons or existing public data, verify price ascending,
price descending, and next availability across page boundaries, and confirm
unpublished salons stay hidden. Merge the app PR only after these checks pass;
then verify the Vercel production deployment and live sort controls.

## Rollback

If sorting fails after deployment, revert the app PR or rely on its explicit
relevance fallback while investigating. Once the app no longer needs the sorted
RPC, apply only `supabase/rollbacks/20261017220612_drop_public_salon_sorting.sql`
with separate approval. Reconcile the rollback history to leave the forward
migration pending, and verify the original relevance RPC still works. The rollback
does not delete salon or booking data.

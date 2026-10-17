-- GLOW-46 rollback: remove only the additive sorted search RPC.
-- The original search_public_salons RPC and all stored data remain unchanged.
drop function if exists public.search_public_salons_sorted(
  text, text, text, text, text, text, integer, timestamptz, integer, integer
);

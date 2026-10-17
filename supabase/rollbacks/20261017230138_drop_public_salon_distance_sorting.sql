-- GLOW-46 operational rollback: disable distance search without deleting owner pins.
-- Keep the coordinate columns, generated point, GiST index, and shared PostGIS extension.
-- Existing relevance and price/availability RPCs remain available.
drop function if exists public.search_public_salons_by_distance(
  double precision, double precision, text, text, text, text, text,
  integer, timestamptz, integer, integer
);

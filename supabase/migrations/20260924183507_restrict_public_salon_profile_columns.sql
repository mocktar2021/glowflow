-- GLOW-37: keep anonymous discovery on an explicit public field allowlist.
-- Authenticated access remains unchanged and is still constrained by RLS.

revoke select on public.salon_public_profiles from anon;
grant select (
  tenant_id,
  slug,
  business_name,
  description_json,
  country_code,
  city,
  postal_code,
  categories,
  product_keywords,
  image_url,
  next_available_at,
  is_published,
  search_vector,
  address_line1,
  administrative_area,
  public_phone,
  opening_hours,
  team_json,
  policies_json,
  payment_methods,
  gallery_urls
) on public.salon_public_profiles to anon;

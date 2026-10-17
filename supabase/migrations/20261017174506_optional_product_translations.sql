-- GLOW-39: one product name and one image description are sufficient.
-- Preserve the three locale keys so existing API consumers keep a stable shape.
alter table public.salon_products
  drop constraint salon_products_name_json_check,
  drop constraint salon_products_check;

alter table public.salon_products
  add constraint salon_products_name_json_check check (
    jsonb_typeof(name_json) = 'object'
    and name_json - 'fr' - 'en' - 'es' = '{}'::jsonb
    and jsonb_typeof(name_json->'fr') = 'string'
    and jsonb_typeof(name_json->'en') = 'string'
    and jsonb_typeof(name_json->'es') = 'string'
    and (length(trim(name_json->>'fr')) = 0 or length(trim(name_json->>'fr')) between 2 and 120)
    and (length(trim(name_json->>'en')) = 0 or length(trim(name_json->>'en')) between 2 and 120)
    and (length(trim(name_json->>'es')) = 0 or length(trim(name_json->>'es')) between 2 and 120)
    and greatest(
      length(trim(name_json->>'fr')),
      length(trim(name_json->>'en')),
      length(trim(name_json->>'es'))
    ) >= 2
  ),
  add constraint salon_products_check check (
    image_url is null or greatest(
      length(trim(coalesce(image_alt_json->>'fr', ''))),
      length(trim(coalesce(image_alt_json->>'en', ''))),
      length(trim(coalesce(image_alt_json->>'es', '')))
    ) > 0
  );

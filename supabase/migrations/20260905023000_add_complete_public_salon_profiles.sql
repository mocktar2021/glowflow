-- GLOW-43: owner-managed public salon profiles and public salon media.

alter table public.salon_public_profiles
  add column address_line1 text not null default '',
  add column administrative_area text not null default '',
  add column public_phone text,
  add column opening_hours jsonb not null default '{}'::jsonb,
  add column team_json jsonb not null default '[]'::jsonb,
  add column policies_json jsonb not null default '{}'::jsonb,
  add column payment_methods text[] not null default '{}'::text[],
  add column gallery_urls text[] not null default '{}'::text[];

alter table public.salon_public_profiles
  add constraint salon_public_profiles_opening_hours_object
    check (jsonb_typeof(opening_hours) = 'object'),
  add constraint salon_public_profiles_team_array
    check (jsonb_typeof(team_json) = 'array' and jsonb_array_length(team_json) <= 20),
  add constraint salon_public_profiles_policies_object
    check (jsonb_typeof(policies_json) = 'object'),
  add constraint salon_public_profiles_payment_methods_allowed
    check (payment_methods <@ array['card', 'cash', 'deposit', 'mixed']::text[]),
  add constraint salon_public_profiles_gallery_limit
    check (cardinality(gallery_urls) <= 8);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'salon-public-media',
  'salon-public-media',
  true,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy salon_public_media_owner_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'salon-public-media'
  and exists (
    select 1
    from public.users
    where users.id = (select auth.uid())
      and users.role = 'owner'
      and users.tenant_id::text = (storage.foldername(name))[1]
  )
);

create policy salon_public_media_owner_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'salon-public-media'
  and exists (
    select 1
    from public.users
    where users.id = (select auth.uid())
      and users.role = 'owner'
      and users.tenant_id::text = (storage.foldername(name))[1]
  )
);

create policy salon_public_media_owner_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'salon-public-media'
  and exists (
    select 1
    from public.users
    where users.id = (select auth.uid())
      and users.role = 'owner'
      and users.tenant_id::text = (storage.foldername(name))[1]
  )
)
with check (
  bucket_id = 'salon-public-media'
  and exists (
    select 1
    from public.users
    where users.id = (select auth.uid())
      and users.role = 'owner'
      and users.tenant_id::text = (storage.foldername(name))[1]
  )
);

create policy salon_public_media_owner_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'salon-public-media'
  and exists (
    select 1
    from public.users
    where users.id = (select auth.uid())
      and users.role = 'owner'
      and users.tenant_id::text = (storage.foldername(name))[1]
  )
);

create index salon_public_profiles_published_slug_idx
  on public.salon_public_profiles (slug)
  where is_published = true;

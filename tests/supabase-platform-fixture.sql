-- Minimal Supabase platform substitutes for a NEW disposable localhost database.
-- These are not application tables or policies. Load schema.sql and every ordered
-- migration afterwards. This fixture does not simulate HTTP Auth, JWT validation,
-- object uploads, Realtime delivery, or Supabase-managed default ACL changes.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if exists (select from pg_roles where rolname in ('anon', 'authenticated')
             and (rolsuper or rolbypassrls)) then
    raise exception 'Local client roles must not bypass RLS';
  end if;
end;
$$;

create schema auth;
create schema storage;
create schema extensions;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- Application client privileges must come from the application SQL itself.
-- Only the server role receives the platform's broad table access.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

create table auth.users (
  id uuid primary key,
  email text
);
create function auth.uid() returns uuid
language sql stable set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;
create function auth.jwt() returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;
create function storage.foldername(name text) returns text[]
language sql immutable set search_path = ''
as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

-- The walk-in migration registers its table in this platform publication.
create publication supabase_realtime;

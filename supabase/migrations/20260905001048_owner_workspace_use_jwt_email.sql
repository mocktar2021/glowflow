create or replace function public.create_owner_workspace(
  salon_name text,
  requested_slug text,
  owner_full_name text,
  owner_locale text default 'fr',
  workspace_currency text default 'EUR'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := nullif(auth.jwt() ->> 'email', '');
  workspace_id uuid;
  safe_slug text;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if exists (select 1 from public.users where id = current_user_id) then
    select tenant_id into workspace_id from public.users where id = current_user_id;
    return workspace_id;
  end if;
  if current_email is null then raise exception 'verified_email_required'; end if;
  if char_length(trim(salon_name)) not between 2 and 120 then raise exception 'invalid_salon_name'; end if;
  if char_length(trim(owner_full_name)) not between 2 and 120 then raise exception 'invalid_owner_name'; end if;
  if owner_locale not in ('fr', 'en', 'es') then raise exception 'invalid_locale'; end if;
  if workspace_currency not in ('EUR', 'USD') then raise exception 'invalid_currency'; end if;
  safe_slug := lower(regexp_replace(trim(requested_slug), '[^a-z0-9]+', '-', 'g'));
  safe_slug := trim(both '-' from safe_slug);
  if safe_slug = '' or safe_slug !~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' then
    safe_slug := 'salon-' || substr(replace(current_user_id::text, '-', ''), 1, 8);
  end if;
  if exists (select 1 from public.tenants where slug = safe_slug) then
    safe_slug := safe_slug || '-' || substr(replace(current_user_id::text, '-', ''), 1, 6);
  end if;
  insert into public.tenants (name, slug, owner_id, primary_language, currency)
  values (trim(salon_name), safe_slug, current_user_id, owner_locale, workspace_currency)
  returning id into workspace_id;
  insert into public.users (id, tenant_id, full_name, email, role, locale)
  values (current_user_id, workspace_id, trim(owner_full_name), current_email, 'owner', owner_locale);
  return workspace_id;
end;
$$;

revoke all on function public.create_owner_workspace(text, text, text, text, text) from public, anon;
grant execute on function public.create_owner_workspace(text, text, text, text, text) to authenticated;

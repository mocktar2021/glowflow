-- GLOW-9: inactive owner-bound invitation preparation.
-- A later reviewed server flow must handle delivery and abuse limits. This
-- private function has no application-role EXECUTE grant or email side effect.
begin;

do $$
begin
  if to_regclass('private.staff_invitations') is null
     or to_regprocedure('public.accept_staff_invitation(text,text,text)') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception using errcode = '55000',
      message = 'staff_invitation_issuer_predecessor_missing';
  end if;
end;
$$;

create function private.prepare_staff_invitation(target_email text)
returns table (raw_token text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_target_email text := pg_catalog.lower(pg_catalog.btrim(target_email));
  owner_tenant_id uuid;
  issued_at timestamptz;
  invite_token text;
begin
  if actor_id is null
     or normalized_target_email is null
     or pg_catalog.char_length(normalized_target_email) not between 3 and 320
     or normalized_target_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'staff_invitation_unavailable';
  end if;

  -- Derive the salon from the current owner. Never accept a tenant ID from
  -- the caller. Recheck this relationship under locks before inserting.
  select tenant.id into owner_tenant_id
  from public.tenants as tenant
  join public.users as owner_membership
    on owner_membership.id = tenant.owner_id
   and owner_membership.tenant_id = tenant.id
   and owner_membership.role = 'owner'
  where tenant.owner_id = actor_id;

  if not found then
    raise exception using errcode = '22023', message = 'staff_invitation_unavailable';
  end if;

  -- Acceptance locks its invitation before the tenant. Follow the same
  -- order to avoid a resend/acceptance deadlock, then lock the owner and
  -- tenant to serialize concurrent preparations, including the first one.
  perform 1
  from private.staff_invitations as invitation
  where invitation.tenant_id = owner_tenant_id
    and invitation.email_normalized = normalized_target_email
    and invitation.accepted_at is null
    and invitation.revoked_at is null
  order by invitation.id
  for update;

  perform 1
  from public.tenants as tenant
  join public.users as owner_membership
    on owner_membership.id = tenant.owner_id
   and owner_membership.tenant_id = tenant.id
   and owner_membership.role = 'owner'
  where tenant.id = owner_tenant_id
    and tenant.owner_id = actor_id
  for update of tenant, owner_membership;

  if not found then
    raise exception using errcode = '22023', message = 'staff_invitation_unavailable';
  end if;

  issued_at := pg_catalog.clock_timestamp();
  update private.staff_invitations as invitation
  set revoked_at = issued_at
  where invitation.tenant_id = owner_tenant_id
    and invitation.email_normalized = normalized_target_email
    and invitation.accepted_at is null
    and invitation.revoked_at is null;

  -- Thirty-two cryptographically random bytes become 43 unpadded base64url
  -- characters. Persist only the SHA-256 digest of that exact string.
  invite_token := pg_catalog.rtrim(
    pg_catalog.translate(
      pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'
    ), '='
  );

  insert into private.staff_invitations
    (tenant_id, inviter_id, email_normalized, token_hash, created_at, expires_at)
  values
    (owner_tenant_id, actor_id, normalized_target_email,
     pg_catalog.sha256(pg_catalog.convert_to(invite_token, 'UTF8')),
     issued_at, issued_at + interval '48 hours');

  return query select invite_token, issued_at + interval '48 hours';
end;
$$;

-- The issuer is deliberately inaccessible to application roles. A later
-- sender may use a separately reviewed wrapper with rate limits and logging
-- controls, without exposing the raw token to browsers.
revoke all on function private.prepare_staff_invitation(text)
  from public, anon, authenticated, service_role;

comment on function private.prepare_staff_invitation(text) is
  'Inactive GLOW-9 invitation preparation: 48-hour token, atomic resend revocation, no sender or application grant.';

commit;

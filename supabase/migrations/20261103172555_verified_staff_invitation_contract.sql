-- GLOW-9: inactive verified staff-invitation acceptance contract.
-- No invitation issuance, email delivery, or application route is enabled here.
-- The product policy for expiry duration and resend remains undecided.
begin;

create table private.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  inviter_id uuid not null,
  email_normalized text not null check (
    char_length(email_normalized) between 3 and 320
    and email_normalized = lower(btrim(email_normalized))
    and email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at),
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid,
  check ((accepted_at is null) = (accepted_by is null)),
  check (accepted_at is null or revoked_at is null)
);

create index staff_invitations_tenant_email_idx
  on private.staff_invitations (tenant_id, email_normalized, created_at desc);

alter table private.staff_invitations enable row level security;
-- There are deliberately no client policies or direct grants. A later,
-- separately reviewed issuer must authorize the owner and choose expiry.
revoke all on table private.staff_invitations
  from public, anon, authenticated, service_role;

create function public.accept_staff_invitation(
  raw_token text,
  requested_full_name text,
  requested_locale text default 'fr'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  invitation private.staff_invitations%rowtype;
  actor_id uuid := (select auth.uid());
  verified_email text;
  inserted_id uuid;
begin
  -- A single generic error avoids disclosing whether an email, account,
  -- tenant, or invitation exists. Issuers must generate 32 random bytes and
  -- encode them as unpadded base64url (43 characters).
  if actor_id is null
     or raw_token is null
     or raw_token !~ '^[A-Za-z0-9_-]{43}$'
     or requested_full_name is null
     or char_length(btrim(requested_full_name)) not between 2 and 120
     or requested_locale is null
     or requested_locale not in ('fr', 'en', 'es') then
    raise exception using errcode = '22023', message = 'staff_invitation_unavailable';
  end if;

  select * into invitation
  from private.staff_invitations
  where token_hash = pg_catalog.sha256(pg_catalog.convert_to(raw_token, 'UTF8'))
  for update;

  if not found
     or invitation.revoked_at is not null
     or invitation.accepted_at is not null
     or invitation.expires_at <= now() then
    raise exception using errcode = '22023', message = 'staff_invitation_unavailable';
  end if;

  -- Read the Auth-controlled, currently confirmed email, not a form field,
  -- user_metadata, or a stale JWT email claim. Lock it against a concurrent
  -- Auth email change until membership creation commits.
  select lower(btrim(identity.email)) into verified_email
  from auth.users as identity
  where identity.id = actor_id
    and identity.email_confirmed_at is not null
  for share;

  if not found or verified_email is distinct from invitation.email_normalized then
    raise exception using errcode = '22023', message = 'staff_invitation_unavailable';
  end if;

  -- Do not attach a recipient to an orphaned tenant. The owner and tenant
  -- rows are locked so their authorization relationship cannot change here.
  perform 1
  from public.tenants as tenant
  join public.users as owner_membership
    on owner_membership.id = tenant.owner_id
   and owner_membership.tenant_id = tenant.id
   and owner_membership.role = 'owner'
  where tenant.id = invitation.tenant_id
  for share of tenant, owner_membership;

  if not found then
    raise exception using errcode = '22023', message = 'staff_invitation_unavailable';
  end if;

  -- public.users.id remains the one-salon-per-login key. ON CONFLICT also
  -- makes simultaneous acceptance of separate invitations fail closed.
  insert into public.users (id, tenant_id, full_name, email, role, locale)
  values (
    actor_id, invitation.tenant_id, btrim(requested_full_name),
    verified_email, 'staff', requested_locale
  )
  on conflict do nothing
  returning id into inserted_id;

  if inserted_id is null then
    raise exception using errcode = '22023', message = 'staff_invitation_unavailable';
  end if;

  update private.staff_invitations
  set accepted_at = now(), accepted_by = actor_id
  where id = invitation.id;
  return invitation.tenant_id;
end;
$$;

-- Security-definer functions receive PUBLIC EXECUTE by default.
revoke all on function public.accept_staff_invitation(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_staff_invitation(text, text, text)
  to authenticated;

comment on table private.staff_invitations is
  'Inactive GLOW-9 invitation audit and token-hash store; no issuer or mailer is enabled.';
comment on function public.accept_staff_invitation(text, text, text) is
  'Atomically accepts a verified-email-bound staff invitation; no invitation issuance or email sending.';

commit;

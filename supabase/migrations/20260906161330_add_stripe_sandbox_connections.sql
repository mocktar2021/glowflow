-- GLOW-23: sandbox onboarding is isolated from live tenant payment destinations.
create table public.stripe_sandbox_connections (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  stripe_account_id text unique,
  created_at timestamptz not null default now(),
  constraint stripe_sandbox_account_format check (
    stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  )
);
alter table public.stripe_sandbox_connections enable row level security;
revoke all on public.stripe_sandbox_connections from public, anon, authenticated;
grant select on public.stripe_sandbox_connections to authenticated;
grant select, insert, update on public.stripe_sandbox_connections to service_role;
create policy stripe_sandbox_owner_read on public.stripe_sandbox_connections
for select to authenticated using (
  exists (select 1 from public.tenants t
    where t.id = tenant_id and t.owner_id = (select auth.uid()))
);
-- Rollback before activation: drop table public.stripe_sandbox_connections.
-- After onboarding, preserve mappings to avoid creating duplicate Stripe accounts.

-- GLOW-9: until invitation acceptance verifies the recipient and consent,
-- an owner must not attach a different Auth identity through the Data API.
-- Owner onboarding still inserts its own row through create_owner_workspace.
alter policy users_owner_or_self_insert on public.users
with check (
  id = (select auth.uid())
  and role = 'owner'
  and (select private.is_tenant_owner(tenant_id))
);

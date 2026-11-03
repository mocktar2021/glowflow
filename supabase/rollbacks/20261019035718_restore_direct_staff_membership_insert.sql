-- GLOW-9 rollback restores the former direct owner-to-staff insert permission.
-- It reopens the unconsented Auth-identity attachment gap; use only with review.
alter policy users_owner_or_self_insert on public.users
with check (
  (id = (select auth.uid()) and (select private.is_tenant_owner(tenant_id)))
  or (role = 'staff' and (select private.is_tenant_owner(tenant_id)))
);

-- GLOW-17: covering indexes for service_staff foreign keys.

create index if not exists service_staff_service_tenant_idx
  on public.service_staff (service_id, tenant_id);

create index if not exists service_staff_staff_tenant_idx
  on public.service_staff (staff_id, tenant_id);

-- GLOW-33: immutable appointment payment ledger.
-- Entries are append-only. Corrections use compensating payment/refund entries.

create table public.payment_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  appointment_id uuid not null,
  entry_type text not null check (entry_type in ('payment', 'refund')),
  payment_method text not null check (payment_method in ('stripe', 'cash', 'external_card')),
  amount integer not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  provider_account_id text,
  provider_payment_id text,
  idempotency_key uuid not null,
  actor_user_id uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (appointment_id, tenant_id)
    references public.appointments(id, tenant_id) on delete restrict,
  foreign key (actor_user_id, tenant_id)
    references public.users(id, tenant_id) on delete restrict,
  check (
    (provider_account_id is null and provider_payment_id is null)
    or (nullif(btrim(provider_account_id), '') is not null
        and nullif(btrim(provider_payment_id), '') is not null)
  )
);

create unique index payment_entries_provider_reference_idx
  on public.payment_entries (provider_account_id, provider_payment_id)
  where provider_account_id is not null and provider_payment_id is not null;

create index payment_entries_appointment_occurred_idx
  on public.payment_entries (appointment_id, tenant_id, occurred_at, id);

create or replace function private.validate_payment_entry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tenant_currency text;
  paid_total bigint;
  refunded_total bigint;
begin
  if (select auth.uid()) is not null
     and not (select private.is_tenant_owner(new.tenant_id)) then
    raise exception using errcode = '42501', message = 'payment_owner_required';
  end if;

  -- Serialize entries for one appointment so concurrent refunds cannot exceed payments.
  perform 1
  from public.appointments
  where id = new.appointment_id and tenant_id = new.tenant_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'payment_appointment_not_found';
  end if;

  select currency into tenant_currency
  from public.tenants
  where id = new.tenant_id;

  if new.currency is distinct from tenant_currency then
    raise exception using errcode = '22023', message = 'payment_currency_mismatch';
  end if;

  if new.entry_type = 'refund' then
    select
      coalesce(sum(amount) filter (where entry_type = 'payment'), 0),
      coalesce(sum(amount) filter (where entry_type = 'refund'), 0)
    into paid_total, refunded_total
    from public.payment_entries
    where appointment_id = new.appointment_id
      and tenant_id = new.tenant_id;

    if refunded_total + new.amount > paid_total then
      raise exception using errcode = '22023', message = 'refund_exceeds_paid_amount';
    end if;
  end if;

  return new;
end;
$$;

create trigger payment_entries_validate_before_insert
before insert on public.payment_entries
for each row execute function private.validate_payment_entry();

create or replace function private.reject_payment_entry_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'payment_entries_are_immutable';
end;
$$;

create trigger payment_entries_reject_update_or_delete
before update or delete on public.payment_entries
for each row execute function private.reject_payment_entry_mutation();

alter table public.payment_entries enable row level security;

create policy payment_entries_tenant_select
on public.payment_entries for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy payment_entries_owner_insert
on public.payment_entries for insert to authenticated
with check (
  (select private.is_tenant_owner(tenant_id))
  and actor_user_id = (select auth.uid())
);

revoke all on public.payment_entries from public, anon, authenticated;
grant select, insert on public.payment_entries to authenticated;
grant select, insert on public.payment_entries to service_role;

revoke all on function private.validate_payment_entry() from public, anon, authenticated;
revoke all on function private.reject_payment_entry_mutation() from public, anon, authenticated;

create or replace function public.get_appointment_payment_summary(target_appointment_id uuid)
returns table (
  appointment_id uuid,
  currency text,
  paid_amount bigint,
  refunded_amount bigint,
  net_paid_amount bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    entry.appointment_id,
    entry.currency,
    coalesce(sum(entry.amount) filter (where entry.entry_type = 'payment'), 0)::bigint,
    coalesce(sum(entry.amount) filter (where entry.entry_type = 'refund'), 0)::bigint,
    coalesce(sum(case when entry.entry_type = 'payment' then entry.amount else -entry.amount end), 0)::bigint
  from public.payment_entries as entry
  where entry.appointment_id = target_appointment_id
  group by entry.appointment_id, entry.currency;
$$;

revoke all on function public.get_appointment_payment_summary(uuid) from public, anon;
grant execute on function public.get_appointment_payment_summary(uuid) to authenticated;

comment on table public.payment_entries is
  'Append-only tenant payment and refund entries in minor currency units. Mixed tender uses multiple payment entries.';

-- GLOW-33 rollback for a failed first deployment of the payment ledger.
-- Refuse to remove payment history. Once any entry exists, use a forward repair.

begin;

do $$
begin
  if to_regclass('public.payment_entries') is not null
     and exists (select 1 from public.payment_entries) then
    raise exception using
      errcode = '55000',
      message = 'payment_entries_not_empty_preserve_audit_history';
  end if;
end;
$$;

drop function if exists public.get_appointment_payment_summary(uuid);
drop table if exists public.payment_entries;
drop function if exists private.validate_payment_entry();
drop function if exists private.reject_payment_entry_mutation();

commit;

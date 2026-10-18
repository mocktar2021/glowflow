-- GLOW-27 operational rollback: stop automatic email scheduling only.
-- Preserve the append-only consent, outbox, and delivery-attempt history.

begin;

drop trigger if exists appointments_enqueue_confirmed_email on public.appointments;
drop function if exists private.enqueue_confirmed_appointment_email();

commit;

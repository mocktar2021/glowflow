-- GLOW-29 operational rollback: fail closed, preserve immutable audit history.
-- Never restore the prior NULL/future-consent eligibility behavior.
-- Review against the exact hosted revision before any separately approved use.

begin;

revoke execute on function public.claim_notification_delivery(uuid, uuid, timestamptz)
from service_role;

drop trigger if exists appointments_enqueue_confirmed_email on public.appointments;

commit;

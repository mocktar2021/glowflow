-- GLOW-9 operational rollback: stop future queue and claim calls without
-- deleting invitation history, encrypted pending payloads, or memberships.
-- Review against the exact hosted revision before separately approved use.
begin;

revoke execute on function public.enqueue_staff_invitation_delivery(uuid,text,uuid,text)
  from service_role;
revoke execute on function public.claim_staff_invitation_delivery(text)
  from service_role;
revoke execute on function public.settle_staff_invitation_delivery(uuid,text,text)
  from service_role;

commit;

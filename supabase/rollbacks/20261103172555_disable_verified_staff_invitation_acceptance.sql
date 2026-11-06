-- GLOW-9 operational rollback: fail closed without deleting invitation audit rows.
-- Review against the exact hosted revision before separately approved use.
-- Never restore direct owner insertion of arbitrary staff memberships.
begin;

revoke execute on function public.accept_staff_invitation(text, text, text)
  from authenticated;

commit;

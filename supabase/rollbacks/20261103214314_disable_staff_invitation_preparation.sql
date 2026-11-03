-- GLOW-9 operational rollback: remove the inactive issuer while preserving
-- all invitation audit rows, accepted memberships, and the acceptance guard.
begin;
drop function if exists private.prepare_staff_invitation(text);
commit;

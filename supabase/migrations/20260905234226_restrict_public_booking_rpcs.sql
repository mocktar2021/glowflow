-- GLOW-22: keep public booking RPCs behind the validated Next.js server boundary.

revoke all on function public.get_public_booking_slots(text, uuid, date)
from public, anon, authenticated;
revoke all on function public.create_public_appointment(text, uuid, uuid, timestamptz, text, text, text, text, uuid)
from public, anon, authenticated;

grant execute on function public.get_public_booking_slots(text, uuid, date)
to service_role;
grant execute on function public.create_public_appointment(text, uuid, uuid, timestamptz, text, text, text, text, uuid)
to service_role;

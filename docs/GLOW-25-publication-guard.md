# GLOW-25 publication guard

Public booking pages, availability, and appointment creation now require the salon owner to publish the salon profile. A direct `/book/<slug>` URL returns not found for a draft profile, and the database functions fail closed even if a caller bypasses the page. The authenticated owner-only Stripe sandbox remains separate and continues to support unpublished test salons.

The booking UI uses neutral French, English, and Spanish guidance to review the salon policy. It makes no cancellation deadline or refund promise.

## Targeted application

This change adds one forward migration and changes no rows. Do not run a blanket `supabase db push` against a project whose migration ledger differs from repository filenames. After separate production approval, verify the exact GlowFlow project and apply only:

```powershell
npx supabase db query --linked --project-ref rfwhqutkiztxkagbhevp --file supabase/migrations/20260925184222_require_published_salon_for_public_booking.sql --output-format json
```

The forward migration and rollback each use an explicit transaction so an error cannot leave
only one of the two public booking functions changed.

## Verification

1. Confirm both `get_public_booking_slots` and `create_public_appointment` contain an `is_published = true` profile predicate.
2. Confirm only `service_role` can execute the public booking functions; `PUBLIC`, `anon`, and `authenticated` cannot.
3. For a disposable draft salon, confirm the public page is 404, availability returns no rows, and appointment creation returns `public_service_not_found` without inserting a client or appointment.
4. Publish the disposable profile and confirm availability returns valid slots and the public booking page renders.
5. Confirm owner-only `?sandbox=1` access still works for an unpublished salon, then clean up the fixture.

## Rollback

If the function change itself causes a verified regression, apply only `supabase/rollbacks/20260925184222_restore_unpublished_public_booking.sql`, then recheck both function definitions and execute privileges. This restores the previous functions and therefore reopens the known unpublished-salon booking exposure. No row rollback is required because the forward migration changes definitions only.

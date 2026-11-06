# GLOW-58 design handoff status

This folder is the owner-supplied redesign handoff, with its tonal photo
placeholders replaced by original photorealistic illustrations. It is a
reviewable design reference, not an approved app-wide brand cutover or a live
salon catalog.

The search cards, salon profile gallery, and salon workspace public-profile
card now use images from `screens/photos/`. Matching PNG screenshots were
recaptured at 1440 px desktop and 390 px mobile where applicable. The source
mockups include fictional salons, appointments, metrics, prices, names, and a
testimonial. None of those values may be copied into production as facts.
Generated images are synthetic, not photographs of those fictional businesses.
Real salon profiles need salon-provided or licensed images with the required
permissions.

The private salon workspace is in scope for GLOW-58, including desktop Today,
calendar, client detail, mobile navigation, and onboarding. GLOW-44 owns the
landing-page implementation, coordinated with the shared GLOW-58 identity.
The handoff's proposed Porcelain & Mulberry palette and new logo require
explicit owner visual approval before replacing the currently approved brand
in the app or changing repository agent rules.

This import changes no app code, production assets, booking or payment flows,
Supabase schema or data, Vercel settings, or deployed behavior.

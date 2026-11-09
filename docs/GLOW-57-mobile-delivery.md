# GLOW-57 mobile delivery plan

This is a code-only PWA foundation, not proof of Android or iOS store readiness.
The existing web manifest and approved icons came from GLOW-45. The new service
worker gives FR/EN/ES navigation a clear offline response and never writes to
Cache Storage. Live pages and API responses remain network-only, including
private tenant data, Auth, availability, bookings, and payments. Failed POSTs
are not queued or replayed. The web app remains usable if service-worker
registration is unsupported or fails.

## Delivery sequence

1. Verify installation on Android Chrome and iOS Safari with the current
   manifest and icons. On iOS, test Add to Home Screen separately from Android's
   install prompt. Test launch, upgrade, uninstall, and FR/EN/ES offline copy on
   real devices. Do not claim device acceptance from source tests alone.
2. Keep the installed PWA as the first mobile surface. Review signed-in owner,
   staff, public search, and booking journeys at phone sizes and with assistive
   technologies. Do not introduce offline booking, payment, or cached availability
   without a separate safety design and approval.
3. Choose Android and iOS store delivery architecture after testing the PWA:
   Android Trusted Web Activity or a maintained native wrapper are candidates;
   iOS needs its own app-shell, Auth/deep-link, review, and maintenance plan.
   A store listing is not implied by a PWA installation.
4. Before store packaging, inventory developer accounts, signing-key ownership,
   fees, privacy disclosures, push-notification scope, deep links, support,
   update cadence, and rollback. Do not purchase accounts or submit builds
   without a separate owner-approved release decision.

The target public origin is `glowflow.beauty` under GLOW-55. Validate production
domain, Auth callbacks, and links there before signing or publishing mobile
packages. This work does not change the current production domain or hosted
settings.

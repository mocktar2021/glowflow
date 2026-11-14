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

## Real-device PWA acceptance record

For each Android Chrome and iOS Safari device, record the device/OS/browser,
origin, tested commit, date, and whether the run used only public/read-only
screens or a separately approved synthetic account. Check installation from
the browser, icon/name/launch destination, FR/EN/ES language selection,
background-and-relaunch, service-worker update after a new deployment, and
uninstall/reinstall. On iOS, use Add to Home Screen and test the launched icon;
do not count a Safari tab as an installed-app test.

With networking disabled, navigate to a public and a private route in each
language. The offline page must be localized, return no customer details, and
explain that availability, bookings, and payments need a connection. A failed
synthetic booking POST must not be queued or replayed when networking returns.
Restore networking and verify a fresh public response and a signed-in route.
Test Auth signup/reset callbacks and a payment return in the actual installed
context before using a native shell; an external browser or WebView may not
share the same session or GLOW-56 same-browser booking marker.

The prepared locale-launch change starts at `/salons` and redirects by the
visitor's locale cookie when online. For a later offline launch, the localized
page sends only its validated FR/EN/ES language to the service worker, which
stores that one preference in IndexedDB. The worker still stores no responses.
An offline `/salons` launch uses that preference; if browser storage is absent
or evicted, it falls back to French within a bounded wait. Chromium tests
cover EN/ES fresh-page offline launches and a worker upgrade, but real Android
and iOS installations still need acceptance. An app opened offline before its
service worker first installs online cannot show the worker's offline page.

## Native distribution decision before packaging

An Android Trusted Web Activity requires the final web origin and a verified
Digital Asset Links association to the signed Android package. The existing
QA and future beauty origins are separate origins. Choose a stable package
identity and signing owner only after the beauty domain and deployment boundary
are verified. An iOS wrapper needs its own navigation, Auth/deep-link and
payment-return proof, plus enough app functionality for App Store review.

Classify both money flows before store submission: salon SaaS subscription
access and customer deposits for physical salon services may fall under
different store payment rules. Review the exact in-app purchase and external
link behavior against current [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
and [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en).
Do not assume that the web Stripe Checkout path can be copied into a store
app. Google's [Trusted Web Activity integration guide](https://developer.chrome.com/docs/android/trusted-web-activity/integration-guide/)
documents the Digital Asset Links requirement. Record the chosen architecture,
payment classification, account/signing costs, privacy disclosures, and owner
release decision before building or submitting either package.

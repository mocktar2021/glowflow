# GLOW-42 selected service from discovery

Published salon profiles now show a localized booking link on each active service. The link carries the locale, salon slug and service UUID. The booking page validates the UUID against that salon's active catalog, then initializes the form with that exact service and the trusted salon currency/time zone. Changing the requested service remounts the form so a previous selection or slot cannot carry over.

Malformed, repeated, inactive and foreign service selections return not-found; they never silently fall back to the first service or to the offline demo. Links with no selected service retain the existing service picker. Changing the picker updates the service query in browser history without navigating, preserving all other query parameters and the hash so locale switching keeps the latest selection. Sandbox configuration/owner gates and reservation status handling are preserved.

Validation: 21 focused Node tests pass (discovery booking, public booking UI, salon profile), including all three locales, cross-salon/inactive IDs, duplicate query parameters, offline fallback rejection, sandbox gates, rendered initial selection and service query/history preservation. The follow-up reran all 11 discovery/public-booking UI tests; the 10 unchanged profile tests passed in the initial run. Focused ESLint and diff checks pass. These tests use deterministic catalog fixtures and do not claim a deployed end-to-end payment.

Remaining GLOW-42 acceptance includes full search-to-booking browser evidence on a configured preview, actual deposit success/failure and conflict recovery through the database/provider, confirmation delivery, and analytics acceptance. This change neither enables payments nor changes database policy, country configuration or notification delivery. Production verification follows owner-approved merge.

## Country continuity follow-up

The booking page now displays the salon's authoritative tenant country beside its city. For public bookings, it also checks that this country matches the published profile used in marketplace discovery. A mismatch returns not-found before rendering a booking form, rather than silently presenting a different checkout market. The country is not copied into the browser booking payload; the server and database continue to derive market and currency from the selected salon.

Local browser fixtures verify that country remains visible alongside the selected service across French, English, Spanish, and a language change. The existing booking page and confirmation tests cover trusted service, currency, salon time zone, and stored confirmation details. No schema, payment-provider, or analytics behavior changes in this follow-up. A configured preview search-to-profile-to-booking run and the remaining GLOW-42 payment, confirmation-delivery, and analytics acceptance are still open.

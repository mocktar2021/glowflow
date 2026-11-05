# GLOW-56 explicit prepared completion draft

This code-only draft keeps v2 disabled. A recovery check only reads the exact
intent. It never commits a prepared intent automatically.

The separate **Finish the original booking** action is available only in the
same mounted tab that submitted the original immutable booking choice and
received a matching `prepared` response. It displays the remembered salon,
service, published staff choice, start time, salon time zone, and price that
was shown when the request began. That price is not a guaranteed quote; the
visitor must confirm the final amount with the salon. The action rechecks the
exact intent and browser capability, then sends only the intent ID to the
existing commit RPC. A cancel marker,
storage failure, changed generation, quota denial, or unknown response keeps
the form locked. Only an authoritative confirmed result is shown as booked.

After reload or in another tab, the in-memory choice is gone. The current
`reconcile_public_booking_intent` prepared response includes only state,
intent ID, and generation, so those pages must not offer a blind Finish
button. They can check status, request cancellation, or direct the visitor to
the salon. A future post-reload Finish flow needs a separately reviewed,
cookie- and intent-bound non-contact summary RPC and a versioned migration.
No hosted SQL or environment change is authorized by this draft.

An already in-flight Confirm can reach the server before a Cancel from another
tab. The intent RPC serializes server-recorded Commit and Cancel and returns
the authoritative outcome; the browser must not claim cancellation merely
because the visitor tapped Cancel. Before activation, verify this complete
path against the real route and a disposable database, approve quota limits
and cleanup operations, and review the v1-to-v2 cutover gates.

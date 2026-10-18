# GLOW-34 safe booking error context

The public booking API emits `glowflow_application_failure` as one JSON line for
unexpected availability, appointment-creation, confirmation, and optional
enrichment failures. It includes a generated `request_id`, a fixed route and
method, an allowlisted stage, and a coarse code. Failed 500 responses also carry
the ID in `x-glowflow-error-id` so support can correlate a report with the log.
Normal validation errors and slot conflicts are not application failures.

The event never serializes a request, URL, body, header, client contact field,
Supabase error, payment identifier, token, or exception message. The log call is
best-effort and does not change a booking result or retry behavior. The API
responds with a generic error and `private, no-store` on logged 500s.

To investigate a report, search the deployment's server logs for the exact
`request_id`. Use `route`, `method`, `stage`, and `code` to narrow the failing
boundary. Do not paste request bodies, provider errors, or client details into
incident comments. Access to logs must be limited to authorized operators.

This PR does **not** configure a log drain or alert destination, create a
reminder delivery worker, change production settings, or send notifications.
GLOW-34 remains open: payment-webhook and reminder-job alerts, health and
latency/failure-rate checks, and named operational owners require a separate
implementation and an agreed alert destination. Notification outbox persistence
exists, but no reminder delivery worker currently runs.

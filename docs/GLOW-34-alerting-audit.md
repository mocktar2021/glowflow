# GLOW-34 dormant alerting contract

Status: audit and test groundwork only. No alert is active. This change does
not install a log drain, destination, monitor, reminder worker, cron job or
provider integration, and it sends no customer or operator message.

## What exists today

- Public booking failures emit `glowflow_application_failure` with a generated
  request ID, allowlisted route, method, stage and coarse code. Unexpected 500
  responses expose that ID in `x-glowflow-error-id` for support correlation.
  Validation errors and expected slot conflicts do not emit a failure event.
- Sandbox payment checkout and webhook boundaries emit
  `glowflow_payment_failure` with fixed environment, stage and code values.
  Signed webhook persistence failures return 503 so the provider can retry.
  Missing or invalid signatures return 400 and are not treated as application
  failures. The focused route test now also verifies that a Stripe-client
  bootstrap exception emits only the safe `webhook_client` event, without the
  exception text or signed payload. A checkout-route test feeds hostile provider
  details into a failed attach and proves the retryable response and log retain
  only one fixed `checkout_attach` event, with no extra log arguments. Invalid
  input, anonymous access, and an intentionally disabled sandbox do not create
  false failure signals.
- The notification outbox and delivery-attempt tables are append-only
  persistence. There is no delivery worker or provider send. Consequently,
  there is no reminder-job failure event or active reminder alert to monitor.
- Vercel server logs can be inspected by authorized operators, but no alert
  destination, acknowledgement channel, ownership rota or exercised escalation
  is configured. An error log is evidence for investigation, not an alert.

The diagnostic payloads must remain a fixed vocabulary. Never add request
bodies, URLs with query strings, provider objects, email, phone, client names,
booking IDs, payment identifiers, secrets or raw exception messages to logs or
incident tickets. Limit log access to authorized operators.

## Contract for a later alert implementation

| Signal | Candidate source | Operator action | Guard against false or unsafe alerts |
| --- | --- | --- | --- |
| Public booking unexpected failure | Count `glowflow_application_failure` by route, stage and code; correlate a specific report using its request ID | Check the affected deployment and database boundary; confirm whether a booking committed before any retry | Exclude expected validation and slot conflicts; never include client or request details in the alert |
| Sandbox signed-webhook processing failure | Count `glowflow_payment_failure` at `webhook_client`, `webhook_event`, or `webhook_persist`, paired with 503 response monitoring | Check provider retry status, exact deployment and trusted payment records under authorized access; preserve retry semantics | Do not alert on invalid signatures, unrelated events or intentionally disabled sandbox configuration; do not expose signed payloads or provider IDs |
| Reminder delivery failure or overdue work | Future worker's allowlisted failure events and aggregate counts of eligible current-generation outbox entries or terminal failed attempts | Inspect worker availability, consent gate, retry state and provider status before taking action | Do not count stale generations, canceled appointments, opt-outs, unknown consent or not-yet-due reminders; no worker exists today |
| Availability and latency | Read-only synthetic GET checks plus server-side request metrics | Triage an unreachable route or a sustained p95 regression by deployment and region | Never create a booking or payment as a health probe; require a real denominator before computing error rates |

Alert policy should be based on sustained failure count or rate in an approved
window, not one malformed external request. The operator must set the window,
numerator, denominator, minimum traffic and severity for each route. A p95
latency gate needs an agreed endpoint, measurement source, region, sample size
and budget. Current diagnostic events alone do not supply success counts or
durations, so they cannot establish failure rate or p95. Do not invent a
threshold or claim an SLO has been met.

## Owner and activation gates

Before routing any event, record a named primary and alternate incident owner,
their coverage hours, an approved and monitored alert destination, who may
acknowledge and escalate, and a response deadline. For webhook failures,
GLOW-34 records Mocktar Tairou as primary and Admin as backup, with monitored
email addresses confirmed by the owner. Those contacts do not establish
coverage hours, an acknowledgement rota, escalation, a response deadline, or
an active alert route. The product owner must approve the remaining choices;
no paid monitoring service is assumed or required by this proposal.

Then add the smallest sender or platform rule needed for the chosen destination,
with secrets only in provider settings and a redacted payload allowlist. Test a
synthetic failure in an isolated preview, prove one actionable alert reaches
the owner and alternate when appropriate, test acknowledgement and escalation,
and prove the alert body contains no client or payment data. For reminders,
first deliver and verify a worker under GLOW-27/29 with consent and retry
policy. Recheck production behavior after an approved merge. Keep GLOW-34 In
Progress until those gates, health/latency/failure-rate checks and named owners
are actually verified.

No hosted SQL, Auth, Storage, Stripe configuration, deployment setting or
customer record is changed by this audit.

## Owner-approved retry contract for signed deposit events

A correctly signed webhook can contain valid JSON but omit required booking
fields. The owner chose retryable 503 plus alerting for recognizable GlowFlow
deposit events in that state. The route first verifies the raw Stripe signature.
Only expected sandbox Checkout events carrying `metadata.product=glowflow`
are attributable to this product. If one lacks a required account, booking
identifier, amount, currency, or payment identifier, the handler emits a fixed
`webhook_event`/`event_parse_failed` diagnostic and returns a generic 503.
It never passes malformed arguments to the settlement RPC. Invalid signatures
remain 400; signed unrelated or unattributable events, and otherwise valid
unpaid completions, are acknowledged with 200. Valid paid settlement still
uses the atomic database RPC. No signed payload, provider error, or customer
detail is logged.

Mocktar Tairou is the named primary Stripe webhook alert operator and Admin is
the backup role. Their monitored addresses are recorded in GLOW-34 rather than
in source control. Recipients are identified, but coverage hours,
acknowledgement, escalation, and a no-cost delivery path are not verified. The
fixed diagnostic is **not an active alert** and paid flows remain off. Before
activation, route repeated 503/`webhook_event` and `webhook_persist` failures
to both operators, test delivery and acknowledgement, and confirm that the
alert contains only the fixed code and environment. The operator should inspect
the failed delivery in Stripe's webhook dashboard, reconcile the related
reservation in an approved read-only admin view, fix the parser or correlation
fault, then redeliver the same event and confirm idempotent settlement. Do not
copy payloads into logs or manually mark a booking paid. A permanent malformed
event can cause repeated Stripe retries, so unresolved failures must be
escalated while payment activation stays blocked. Tests use synthetic local
signatures only; no provider event, checkout, payment, or message is sent.

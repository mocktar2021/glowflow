# GLOW-34 inactive webhook alert contract

`lib/payment-webhook-operator-alert.ts` classifies only the three existing
sandbox webhook failure diagnostics. It accepts a bounded JSON log line with
exactly four fixed fields, rejects extra fields, and builds an alert candidate
with a fixed action and grouping key. Unrelated known checkout diagnostics are
ignored; malformed or unknown payment diagnostics are marked invalid rather
than treated as healthy.

The candidate names Mocktar Tairou as primary operator and the confirmed
monitored inboxes `glowflow@mocktar.com` and
`mocktar.technologies@gmail.com` as primary and backup. No runtime route
imports the classifier, and it has no transport, schedule, threshold, or
acknowledgement path. Its synthetic tests do not prove that either inbox
receives an alert. This is a safe payload boundary for a later separately
reviewed monitor, not an active alert or a paid-launch gate.

Before activation, confirm coverage hours, escalation and acknowledgement,
approve a sustained-failure policy, install a monitored route, and exercise a
synthetic failure on an isolated Preview without customer or payment details.
Keep existing webhook 503 retry behavior independent of alert delivery. No
provider send, hosted setting, worker, schedule, or production flow is part of
this contract.

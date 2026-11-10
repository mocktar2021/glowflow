# GLOW-34 read-only public route probe samples

`node tests/public-release-smoke.mjs` performs one bounded, anonymous GET per
allowlisted route on `https://glowflow.mocktar.com`. It keeps redirects manual,
never sends a booking or payment, and fails if a public route is unavailable or
the signed-out client directory stops redirecting to login. Each successful
check now reports `duration_ms` for response headers using a monotonic clock.
The output contains route paths, status codes and duration samples only. Network
exceptions are reduced to a route-only failure; exception text is not printed.

This is a **single manual smoke sample**, not an active monitor, alert, server-side
latency measure, error-rate denominator, or p95 service-level result. Do not
combine different routes into one latency percentile or infer availability from
one pass. A later monitor needs repeated per-route observations, agreed region
and traffic window, minimum sample count, failure thresholds, a monitored alert
destination, and a named acknowledgement/escalation rota. Do not activate paid
flows based on this probe.

The fixed origin is the development site. An eventual `glowflow.beauty` launch
needs a separate exact-project/commit/alias check and approved production-safe
probes after QA and production are isolated. No hosted setting, provider send,
customer data, alert rule or scheduler is changed by this code-only slice.

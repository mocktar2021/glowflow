# GLOW-56 legacy booking cutover gate (design only)

Status: proposed, not implemented or approved for hosting. This document adds no migration, policy row, endpoint, scheduled job, or feature flag. The public booking v2 drafts remain off. The same-browser intent contract is in `docs/GLOW-56-same-browser-booking-intent-contract.md`.

## Why an application flag is insufficient

The legacy `POST /api/public-booking` checks `GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED` at handler entry and then calls `public.create_public_appointment` with a browser-supplied request key. A request that passed the check can finish its database transaction after the flag changes. An older deployment URL or a service-role caller can also reach the legacy RPC independently of the new handler. Waiting a fixed time or counting HTTP requests does not prove that all database transactions have finished.

Draft v2 `public.commit_public_booking_intent` currently calls that same `public.create_public_appointment` function. Revoking or rejecting the old function without replacing this call would break v2 commit. A serverless in-memory counter, route-only 410, or direct grant change is not a transaction barrier.

## Proposed database contract

Create a private singleton booking-contract gate with a constrained mode and no direct `anon`, `authenticated`, or application-role write grants. A reviewed migration may install it initially in `legacy` mode while the v2 policy remains unseeded. The gate is global for GlowFlow's public booking contract, not a tenant authorization table. The allowed operating states are:

| Mode | Legacy new booking | V2 new prepare | V2 existing-intent commit/reconcile/cancel/acknowledge |
| --- | --- | --- | --- |
| `legacy` | Allowed | Blocked | Blocked until v2 is safely introduced |
| `frozen` | Blocked | Blocked | Only recovery already proven necessary; normally none during the initial cutover |
| `v2` | Blocked | Allowed only with the approved, seeded intent policy and healthy cleanup | Allowed |
| `v2_no_prepares` | Blocked | Blocked | Allowed until existing intents and their recovery window drain |

At the start of every legacy creation transaction, and before browser advisory, session, intent, request-key, or resource locks in v2 prepare/commit, read the singleton mode `FOR SHARE`. Keep that row lock until the transaction commits or rolls back. A missing row or unrecognized mode must fail closed. A short operator transaction that updates `legacy` to `frozen` needs an exclusive lock on that same row. It cannot commit until all legacy transactions that passed the shared gate have ended. After the freeze transaction commits, newly arriving or previously queued legacy calls observe `frozen` and cannot insert an appointment. Set a bounded lock timeout: on timeout, roll back the freeze, leave v2 off, and investigate rather than claiming a successful drain.

Refactor the current appointment creation body into a private, unexposed core with the same input validation, request-key idempotency, service/staff eligibility, slot check, resource advisory lock, exclusion protection, and confirmation shape. Preserve the public legacy function signature as a wrapper. It takes the shared gate lock first and invokes the core only in `legacy`. Change the v2 commit function to take the shared gate lock first and invoke the private core directly only in `v2` or `v2_no_prepares`. Do not add a caller-controlled `is_v2` argument or session setting that a service-role RPC could spoof. Revoke default `PUBLIC` execute on all new private functions and keep the existing service-role-only public RPC grants. The core should not be independently callable by the application role; inspect function ownership, schema usage, RLS, and security-advisor output before a hosted proposal.

The lock order is gate, then browser advisory lock, browser-session row, intent row, request-key advisory lock, resource advisory lock, and appointment insert. The operator mode update must touch only the gate row in its transaction. Do not hold the exclusive gate lock while querying or locking intent, appointment, or session rows. Cleanup and recovery functions must be checked against this order. This keeps a v1 transaction waiting on a resource from deadlocking with a v2 transaction holding an intent while waiting for the gate.

## Controlled activation sequence

1. Review the exact migration and local two-session race tests. Separately approve and apply only the GlowFlow migration after project identity, ledger, schema, privileges, and fingerprints match. The initial `legacy` mode must preserve current bookings; a failed install must roll back in full. No v2 policy or schedule is implicitly seeded.
2. Finish the private-intent cleanup, session expiry, durable abuse limits, key management, and isolated QA. Keep the v2 public gate off while any of these are missing.
3. Announce a short public-booking pause in FR/EN/ES. Block new legacy admission at the application edge for a better visitor experience, but rely on the database gate for correctness. In a short, separately approved transaction, update `legacy` to `frozen` and commit. A successful commit is the proof that legacy writes which passed the gate have finished. If it times out or fails, keep v2 off and restore the previous user-facing flow only after confirming the database still says `legacy`.
4. Verify mode `frozen`, no new legacy insert, exact migration and policy readiness, and a safe recovery path for an old page whose response was lost. Then transition to `v2` and deploy the reviewed v2 API/UI with its flag on. Either order may briefly make booking unavailable, but neither may expose simultaneous legacy and v2 creation. An old deployment or direct service-role legacy RPC remains blocked by the database.
5. Verify exact production commit and alias, controlled read-only public responses, a synthetic isolated booking journey, and runtime errors. Do not claim duplicate protection before the freeze transaction and v2 mode are both verified.

The owner must decide whether to accept this bounded booking pause and whether unresolved legacy attempts use a manual salon-support path or a separately reviewed, request-key-only compatibility lookup. Such a lookup may return an existing appointment but must never create a new one after freeze. Do not silently reinterpret an old browser request as a new v2 intent.

## Rollback and failure states

Once v2 has accepted an intent, do not set the database mode back to `legacy` or deploy a build that lacks v2 recovery. The existing application flag currently makes the whole v2 route return 404 when off and would strand prepared intents. A rollback must move `v2` to `v2_no_prepares`, keep v2 reconcile/commit/cancel/acknowledge available for already-created intents, and leave legacy new writes blocked. The API should distinguish new-prepare admission from recovery availability; bootstrap must not advertise a new bookable session in no-prepares mode. Leave signed-cookie verification keys available throughout the 24-hour recovery window and retain terminal intent records for the approved 3 days. A failed v2 deployment should remain in this safe paused/recovery state until a forward fix is reviewed. Returning to arbitrary-key legacy creation requires a new safety design and separate approval, not a flag reversal.

## Required local verification before any hosted gate

- In disposable PostgreSQL, hold a legacy transaction after its shared gate lock while it waits on a request-key or resource lock. Prove the operator freeze update waits; release the blocker, let legacy commit, then prove freeze commits and a subsequent legacy attempt cannot create a client or appointment.
- Freeze first, then start a legacy call that began at the HTTP layer earlier. Prove its database call rejects without an insert. Exercise a direct service-role RPC too, because route 410 is not the authority.
- In `v2`, prove an intent-bound commit calls the private core and succeeds while the legacy wrapper rejects. Preserve same-key idempotency, wrong-slot exclusion, tenant isolation, and confirmation snapshot tests.
- In `v2_no_prepares`, prove new prepare fails but existing intent commit, reconciliation, cancellation, and acknowledgement remain available. Verify missing gate row, unexpected mode, transition failure, and lock timeout fail closed.
- Race a freeze against a legacy call blocked on the resource lock and a v2 call waiting on the browser/intent locks. Assert no deadlock or post-freeze legacy insert. Verify mode transitions and privileges with `anon`, `authenticated`, and `service_role` where appropriate.
- Confirm old-page UI receives an accessible localized pause/manual-recovery state and never submits a changed booking under a fresh key. Test rollback with the v2 API still present, not by deploying an old legacy-only build.

No hosted SQL, deployment, live booking, payment, message, or MowFlow action is authorized by this document.

import "server-only";

import { runNextStaffInvitationDelivery } from "@/lib/staff-invitation-runner";
import type { StaffInvitationDeliveryStatus } from "@/lib/staff-invitation-sender";

export type StaffInvitationWorkerAlert = Readonly<{
  code: "delivery_failed" | "delivery_uncertain" | "delivery_unavailable";
  action: "review_before_reissue" | "reconcile_provider" | "inspect_and_reconcile_before_reissue";
}>;

type OperatorAlert = (alert: StaffInvitationWorkerAlert) => Promise<void>;
type RunOnce = () => Promise<StaffInvitationDeliveryStatus>;

/**
 * Library-only boundary for a future scheduled worker. No route or schedule
 * imports it. One invocation runs at most one outbox claim and requires an
 * operator-alert sink; it never retries a send or exposes recipient details.
 */
export async function runStaffInvitationWorkerOnce(
  alertOperator: OperatorAlert,
  runOnce: RunOnce = runNextStaffInvitationDelivery,
): Promise<StaffInvitationDeliveryStatus> {
  if (typeof alertOperator !== "function") {
    // A missing alert path must never be discovered after claiming/sending.
    throw new Error("Staff invitation operator alert unavailable");
  }

  let status: StaffInvitationDeliveryStatus;
  try {
    const result = await runOnce();
    status = result === "disabled" || result === "idle" || result === "sent"
      || result === "failed" || result === "uncertain" || result === "unavailable"
      ? result : "unavailable";
  } catch {
    status = "unavailable";
  }

  const alert: StaffInvitationWorkerAlert | null = status === "failed"
    ? { code: "delivery_failed", action: "review_before_reissue" }
    : status === "uncertain"
      ? { code: "delivery_uncertain", action: "reconcile_provider" }
      : status === "unavailable"
        // Settlement may have failed after the provider accepted the email.
        // Reconcile provider and database state before any new invitation.
        ? { code: "delivery_unavailable", action: "inspect_and_reconcile_before_reissue" }
        : null;

  if (alert) {
    try {
      await alertOperator(alert);
    } catch {
      // Do not leak a provider, database, or alert-service error to job logs.
      // A future scheduler must treat this constant rejection as job failure.
      throw new Error("Staff invitation operator alert unavailable");
    }
  }

  return status;
}

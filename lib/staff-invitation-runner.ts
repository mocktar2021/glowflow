import "server-only";

import { createResendStaffInvitationTransport } from "@/lib/staff-invitation-resend";
import {
  processNextStaffInvitationDelivery,
  type StaffInvitationDeliveryStatus,
} from "@/lib/staff-invitation-sender";
import { staffInvitationManagementEnabled } from "@/lib/staff-invitations";

/**
 * Inactive library entry point for a future, separately reviewed worker.
 * Nothing in the application or a schedule imports this function. The three
 * invitation flags must be on together before it can claim an outbox row.
 */
export async function runNextStaffInvitationDelivery(): Promise<StaffInvitationDeliveryStatus> {
  if (!staffInvitationManagementEnabled()) return "disabled";

  const transport = createResendStaffInvitationTransport();
  if (!transport) return "unavailable";

  return processNextStaffInvitationDelivery(transport);
}

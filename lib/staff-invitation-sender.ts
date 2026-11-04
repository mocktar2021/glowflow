import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { renderStaffInvitationEmail } from "@/lib/staff-invitation-email";
import { staffInvitationsEnabled, validStaffInvitationToken } from "@/lib/staff-invitations";

type Accepted = { kind: "accepted"; messageId: string };
type NotSent = { kind: "not_sent"; retryable: boolean };
type Unknown = { kind: "unknown" };

/**
 * The transport must return not_sent only when it knows no message was
 * accepted. A timeout or lost acknowledgement must return unknown or throw.
 * A later provider adapter must forward the stable idempotency key.
 */
export type StaffInvitationTransport = (message: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  signal: AbortSignal;
}) => Promise<Accepted | NotSent | Unknown>;

export type StaffInvitationDeliveryStatus =
  | "disabled" | "idle" | "sent" | "failed" | "uncertain" | "unavailable";

type Claim = {
  delivery_id: string;
  recipient_email: string;
  raw_token: string;
  expires_at: string;
  idempotency_key: string;
  attempt_number: number;
};

const uuidPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+$/;

function configured() {
  const key = process.env.GLOWFLOW_INVITE_OUTBOX_KEY;
  return staffInvitationsEnabled()
    && process.env.GLOWFLOW_STAFF_INVITE_DELIVERY_ENABLED === "true"
    && typeof key === "string"
    && Buffer.byteLength(key) >= 32
    && Buffer.byteLength(key) <= 256;
}

function validClaim(value: unknown): value is Claim {
  if (!value || typeof value !== "object") return false;
  const claim = value as Record<string, unknown>;
  return typeof claim.delivery_id === "string" && uuidPattern.test(claim.delivery_id)
    && typeof claim.recipient_email === "string"
    && claim.recipient_email.length <= 320
    && emailPattern.test(claim.recipient_email)
    && typeof claim.raw_token === "string" && validStaffInvitationToken(claim.raw_token)
    && typeof claim.expires_at === "string" && Number.isFinite(Date.parse(claim.expires_at))
    && typeof claim.idempotency_key === "string"
    && claim.idempotency_key === `glowflow-staff-invite-${claim.delivery_id}`
    && Number.isInteger(claim.attempt_number)
    && Number(claim.attempt_number) >= 1 && Number(claim.attempt_number) <= 3;
}

/**
 * Not connected to a route, cron, or provider in this phase. A future worker
 * may call this once per job after provider and operational review.
 */
export async function processNextStaffInvitationDelivery(
  deliver: StaffInvitationTransport,
): Promise<StaffInvitationDeliveryStatus> {
  if (!configured()) return "disabled";

  try {
    const admin = createAdminClient();
    const { data: claims, error: claimError } = await admin.rpc(
      "claim_staff_invitation_delivery",
      { encryption_passphrase: process.env.GLOWFLOW_INVITE_OUTBOX_KEY! },
    );
    if (claimError || !Array.isArray(claims)) return "unavailable";
    if (claims.length === 0) return "idle";
    if (claims.length !== 1 || !validClaim(claims[0])) return "unavailable";

    const claim = claims[0];
    let outcome: "sent" | "failed" | "uncertain" = "uncertain";
    let providerReference: string | null = null;

    // Do not send an invitation that is about to expire. This is a definite
    // non-send, so settling it as failed preserves any previous usable link.
    if (claim.attempt_number > 1) {
      // A prior lease may have sent before its acknowledgement was lost.
      // The current DB contract can reclaim it; do not send twice.
      outcome = "uncertain";
    } else if (Date.parse(claim.expires_at) <= Date.now() + 5 * 60_000) {
      outcome = "failed";
    } else {
      const message = renderStaffInvitationEmail(claim.raw_token);
      try {
        const result = await deliver({
          to: claim.recipient_email,
          ...message,
          idempotencyKey: claim.idempotency_key,
          signal: AbortSignal.timeout(10_000),
        });
        if (result?.kind === "accepted"
            && typeof result.messageId === "string"
            && result.messageId.length >= 1 && result.messageId.length <= 200
            && !/[\r\n]/.test(result.messageId)) {
          outcome = "sent";
          providerReference = result.messageId;
        } else if (result?.kind === "not_sent" && typeof result.retryable === "boolean") {
          // Until lease-expiry handling is revised, even a safe retry would
          // come back as attempt two. Fail closed and let the owner reissue.
          outcome = "failed";
        }
      } catch {
        // An exception might occur after provider acceptance. Never retry it
        // automatically without reconciling the provider-side idempotency key.
        outcome = "uncertain";
      }
    }

    const { data: settled, error: settleError } = await admin.rpc(
      "settle_staff_invitation_delivery",
      {
        target_delivery_id: claim.delivery_id,
        delivery_outcome: outcome,
        provider_reference: providerReference,
      },
    );
    return !settleError && settled === true ? outcome : "unavailable";
  } catch {
    // Never log a recipient address, invitation token, or provider response.
    return "unavailable";
  }
}

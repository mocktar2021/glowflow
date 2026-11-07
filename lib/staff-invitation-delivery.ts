import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type QueuedStaffInvitation =
  | { status: "queued"; deliveryId: string }
  | { status: "unavailable" };

const unavailable: QueuedStaffInvitation = { status: "unavailable" };
const uuidPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

function deliveryConfigured() {
  const key = process.env.GLOWFLOW_INVITE_OUTBOX_KEY;
  return process.env.GLOWFLOW_STAFF_INVITE_ISSUANCE_ENABLED === "true"
    && typeof key === "string"
    && Buffer.byteLength(key) >= 32
    && Buffer.byteLength(key) <= 256;
}

/**
 * Not wired to a route or action until a separately reviewed mail sender exists.
 * The database checks owner membership and durable abuse limits again.
 */
export async function queueStaffInvitationDelivery(
  email: string,
  requestKey: string,
): Promise<QueuedStaffInvitation> {
  if (!deliveryConfigured() || !uuidPattern.test(requestKey)
      || typeof email !== "string" || email.length > 320) return unavailable;

  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.email_confirmed_at) return unavailable;

  try {
    const { data: deliveryId, error: queueError } = await createAdminClient().rpc(
      "enqueue_staff_invitation_delivery",
      {
        requesting_owner_id: data.user.id,
        target_email: email,
        delivery_request_key: requestKey,
        encryption_passphrase: process.env.GLOWFLOW_INVITE_OUTBOX_KEY!,
      },
    );
    if (queueError || typeof deliveryId !== "string" || !uuidPattern.test(deliveryId)) {
      return unavailable;
    }
    return { status: "queued", deliveryId };
  } catch {
    // Do not put recipient addresses, token material, or database errors in logs.
    return unavailable;
  }
}

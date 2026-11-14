import "server-only";

import type { StaffInvitationTransport } from "@/lib/staff-invitation-sender";

const resendEndpoint = "https://api.resend.com/emails";
const sendingDomain = "email.glowflow.mocktar.com";
const emailPattern = /^[^\s@<>]+@[^\s@<>]+$/;
const invitationKeyPattern = /^glowflow-staff-invite-[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

function validEmail(value: string): boolean {
  return value.length <= 320 && emailPattern.test(value) && !/[\r\n]/.test(value);
}

/**
 * Configuration is deliberately absent by default. The adapter is not wired
 * to a route, cron, or worker and cannot send until a separately reviewed
 * activation supplies a GlowFlow-only sending address and monitored reply-to.
 */
export function createResendStaffInvitationTransport(
  fetcher: Fetcher = fetch,
): StaffInvitationTransport | null {
  const apiKey = process.env.GLOWFLOW_RESEND_API_KEY;
  const fromEmail = process.env.GLOWFLOW_RESEND_FROM_EMAIL?.trim().toLowerCase();
  const replyTo = process.env.GLOWFLOW_RESEND_REPLY_TO_EMAIL?.trim().toLowerCase();

  if (!apiKey?.startsWith("re_") || apiKey.length < 20 || apiKey.length > 256
      || !fromEmail || !validEmail(fromEmail)
      || fromEmail.split("@")[1] !== sendingDomain
      || !replyTo || !validEmail(replyTo)) return null;

  return async ({ to, subject, html, text, idempotencyKey, signal }) => {
    // Keep the provider boundary safe even if a future caller bypasses the
    // outbox sender's claim validation. Never issue a request without the
    // invitation's stable key, a single valid recipient, and a live timeout.
    if (typeof to !== "string" || !validEmail(to)
        || typeof idempotencyKey !== "string"
        || !invitationKeyPattern.test(idempotencyKey)
        || !(signal instanceof AbortSignal) || signal.aborted) {
      return { kind: "not_sent", retryable: false };
    }

    // A rejected request is a definite non-send. A timeout, rate limit, server
    // error, or malformed acknowledgement may have been accepted, so the
    // queue must treat it as uncertain and never blindly retry.
    try {
      const response = await fetcher(resendEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          from: `GlowFlow <${fromEmail}>`,
          to: [to],
          reply_to: replyTo,
          subject,
          html,
          text,
        }),
        signal,
        cache: "no-store",
      });

      if ([400, 401, 403, 404, 422].includes(response.status)) {
        return { kind: "not_sent", retryable: false };
      }
      if (response.status < 200 || response.status >= 300) return { kind: "unknown" };

      const data: unknown = await response.json();
      if (!data || typeof data !== "object") return { kind: "unknown" };
      const id = (data as { id?: unknown }).id;
      if (typeof id !== "string" || id.length < 1 || id.length > 200 || /[\r\n]/.test(id)) {
        return { kind: "unknown" };
      }
      return { kind: "accepted", messageId: id };
    } catch {
      return { kind: "unknown" };
    }
  };
}

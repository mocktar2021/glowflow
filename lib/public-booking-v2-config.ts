/** Server-only draft admission gate. This is not the transactional database cutover gate. */
export type PublicBookingV2Mode = "off" | "full" | "recovery_only";

export function publicBookingV2Mode(env: NodeJS.ProcessEnv = process.env): PublicBookingV2Mode {
  const enabled = env.GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED;
  const recoveryOnly = env.GLOWFLOW_PUBLIC_BOOKING_V2_RECOVERY_ONLY;
  // Recovery-only wins over a mistaken false/invalid enabled flag so the
  // current application never reopens v1 during a requested recovery drain.
  if (recoveryOnly === "true" || (recoveryOnly !== undefined && recoveryOnly !== "false")
    || (enabled !== undefined && enabled !== "true" && enabled !== "false")) return "recovery_only";
  return enabled === "true" ? "full" : "off";
}

/** Any active v2 mode closes the legacy route and keeps the v2 page present. */
export function publicBookingV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return publicBookingV2Mode(env) !== "off";
}

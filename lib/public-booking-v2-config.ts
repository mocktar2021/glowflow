/** Server-only rollout gate. The v2 database contract is not approved for hosting yet. */
export function publicBookingV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED === "true";
}

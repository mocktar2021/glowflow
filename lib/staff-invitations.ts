export const staffInvitationsEnabled = () =>
  process.env.GLOWFLOW_STAFF_INVITES_ENABLED === "true";

export const validStaffInvitationToken = (token: string) =>
  /^[A-Za-z0-9_-]{43}$/.test(token);

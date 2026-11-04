export const staffInvitationsEnabled = () =>
  process.env.GLOWFLOW_STAFF_INVITES_ENABLED === "true";

// The owner route stays hidden until recipient acceptance, issuance, and a
// separately reviewed delivery worker are all activated together.
export const staffInvitationManagementEnabled = () =>
  staffInvitationsEnabled()
  && process.env.GLOWFLOW_STAFF_INVITE_ISSUANCE_ENABLED === "true"
  && process.env.GLOWFLOW_STAFF_INVITE_DELIVERY_ENABLED === "true";

export const validStaffInvitationToken = (token: string) =>
  /^[A-Za-z0-9_-]{43}$/.test(token);

export const staffJoinLanguageHref = (locale: "fr" | "en" | "es", token: string) =>
  `/${locale}/join#token=${token}`;

export type Role = "owner" | "admin" | "rep";

export function canSeeAllLeads(role?: Role) {
  return role === "owner" || role === "admin";
}

export function canManageTeam(role?: Role) {
  return role === "owner" || role === "admin";
}

// Pulse (/accounts) is Felipe's PRIVATE account-management watchdog — owner
// only, NOT admins (andrew/lyle hold admin for team management and must not
// see client-conversation contents).
export function canViewPulse(role?: Role) {
  return role === "owner";
}

export function requireOrgSession(session: { userId?: string; orgId?: string } | null) {
  if (!session?.userId || !session?.orgId) {
    throw new Error("unauthorized");
  }
}

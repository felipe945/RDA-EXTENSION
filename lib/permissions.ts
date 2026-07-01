export type Role = "owner" | "admin" | "rep";

export function canSeeAllLeads(role?: Role) {
  return role === "owner" || role === "admin";
}

export function canManageTeam(role?: Role) {
  return role === "owner" || role === "admin";
}

export function requireOrgSession(session: { userId?: string; orgId?: string } | null) {
  if (!session?.userId || !session?.orgId) {
    throw new Error("unauthorized");
  }
}

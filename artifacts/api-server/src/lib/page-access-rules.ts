export type Role = "viewer" | "manager" | "admin";

const ROLE_RANK: Record<Role, number> = { viewer: 0, manager: 1, admin: 2 };

/** True when `userRole` is at least `minRole` in the viewer<manager<admin order. */
export function roleMeets(userRole: Role, minRole: Role): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole];
}

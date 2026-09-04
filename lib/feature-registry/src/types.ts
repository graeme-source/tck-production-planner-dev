export type Role = "viewer" | "manager" | "admin";

export const ROLE_RANK: Record<Role, number> = { viewer: 0, manager: 1, admin: 2 };

/** True when `userRole` is at least `minRole` in the viewer < manager < admin order. */
export function roleMeets(userRole: string, minRole: Role): boolean {
  return (ROLE_RANK[userRole as Role] ?? 0) >= ROLE_RANK[minRole];
}

/**
 * What a feature actually unlocks.
 *
 * - `page`     — a whole page in the sidebar. Its baseline comes from the
 *                access-level selector (page_permissions), not from minRole.
 * - `settings` — one area of the Settings page.
 * - `ability`  — something you can do inside a page you can already open.
 */
export type FeatureKind = "page" | "settings" | "ability";

export type FeatureDef = {
  /** Stable id. NEVER rename one that's live — grants hang off it. */
  key: string;
  name: string;
  description: string;
  /** Grouping in the grants screen, e.g. "Production", "Settings". */
  area: string;
  kind: FeatureKind;
  /** kind="page": the route this unlocks (matches the access-level list). */
  page?: string;
  /** kind="settings": the Settings section id this unlocks. */
  section?: string;
  /**
   * The role that gets this WITHOUT a grant. Page features read their
   * baseline from page_permissions instead (admin-editable), so this is only
   * their fallback when no row exists.
   */
  minRole: Role;
};

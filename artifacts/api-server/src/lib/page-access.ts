import { db, pagePermissionsTable } from "@workspace/db";

// Central role/page-access logic, so Caz can gate each read tool by the SAME
// permission the app already enforces on the corresponding page. If a user
// can't open /stock in the app, Caz won't answer stock questions for them.

export type Role = "viewer" | "manager" | "admin";

const ROLE_RANK: Record<Role, number> = { viewer: 0, manager: 1, admin: 2 };

/** Page defaults, mirrored from routes/page-permissions.ts. Anything not listed
 *  defaults to "viewer" (visible to everyone logged in). */
const DEFAULT_MIN_ROLE: Record<string, Role> = {
  "/sales": "manager",
  "/reports": "viewer",
  "/fulfilment": "manager",
  "/locations": "admin",
  "/dispatch-tag": "manager",
  "/deliveries/receive": "viewer",
  "/training": "manager",
  "/stock": "manager",
  "/suppliers": "manager",
};

/** True when `userRole` is at least `minRole` in the viewer<manager<admin order. */
export function roleMeets(userRole: Role, minRole: Role): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole];
}

export interface PageMinRoles {
  /** Min role for a page key: DB override wins, else built-in default, else "viewer". */
  get(pageKey: string): Role;
}

/** Resolve the current min-role for every page key in one query. */
export async function getPageMinRoles(): Promise<PageMinRoles> {
  const rows = await db.select().from(pagePermissionsTable);
  const overrides = new Map(rows.map(r => [r.pageKey, r.minRole as Role]));
  return {
    get: (pageKey: string): Role =>
      overrides.get(pageKey) ?? DEFAULT_MIN_ROLE[pageKey] ?? "viewer",
  };
}

/** Convenience: can this role access this page key right now? */
export async function canAccessPage(userRole: Role, pageKey: string): Promise<boolean> {
  const min = (await getPageMinRoles()).get(pageKey);
  return roleMeets(userRole, min);
}

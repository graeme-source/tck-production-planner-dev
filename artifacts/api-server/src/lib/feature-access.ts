import { db, appFeaturesTable, appSettingsTable, featureGrantsTable, trainingMatrixItemsTable, trainingRecordsTable, usersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { decideAccess, featureByKey, pageFeatureMap, type Role } from "@workspace/feature-registry";
import { getPageMinRoles } from "./page-access";

// Feature-grant access checks (schema: lib/db/src/schema/features.ts).
// Pure decision logic split out so it's unit-testable; DB lookups thin.

export const SOP_GATE_SETTING_KEY = "feature_sop_gate_enforced";

/**
 * Page routes unlocked by a feature grant, for role-fallback checks.
 * Derived from the registry — it used to be hand-written here AND in the
 * client's App.tsx, which is two places to forget when you add a page.
 */
export const PAGE_FEATURES: Record<string, string> = pageFeatureMap();

export { decideFeatureAccess, type FeatureDecision, type FeatureDecisionInput } from "./feature-access-rules";
import { decideFeatureAccess } from "./feature-access-rules";

export async function isSopGateEnforced(): Promise<boolean> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, SOP_GATE_SETTING_KEY));
  return row?.value === "true";
}

/** Is the user signed off (trained=true) on this SOP in ANY training matrix? */
export async function userTrainedOnSop(userId: number, sopId: number): Promise<boolean> {
  const rows = await db
    .select({ id: trainingRecordsTable.id })
    .from(trainingRecordsTable)
    .innerJoin(trainingMatrixItemsTable, eq(trainingRecordsTable.itemId, trainingMatrixItemsTable.id))
    .where(
      and(
        eq(trainingMatrixItemsTable.sopId, sopId),
        eq(trainingRecordsTable.userId, userId),
        eq(trainingRecordsTable.trained, true)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** Feature keys the user can actually use right now (grant + gate rules). */
export async function allowedFeatureKeys(userId: number): Promise<string[]> {
  const grants = await db
    .select({ featureKey: featureGrantsTable.featureKey })
    .from(featureGrantsTable)
    .where(eq(featureGrantsTable.userId, userId));
  if (grants.length === 0) return [];

  const keys = grants.map((g) => g.featureKey);
  const features = await db.select().from(appFeaturesTable).where(inArray(appFeaturesTable.key, keys));
  const gateEnforced = await isSopGateEnforced();

  const allowed: string[] = [];
  for (const f of features) {
    const trainedOnSop =
      gateEnforced && f.requiredSopId !== null ? await userTrainedOnSop(userId, f.requiredSopId) : true;
    const decision = decideFeatureAccess({ granted: true, gateEnforced, requiredSopId: f.requiredSopId, trainedOnSop });
    if (decision.allowed) allowed.push(f.key);
  }
  return allowed;
}

/** Single-feature check for route guards. */
export async function userHasFeature(userId: number, featureKey: string): Promise<boolean> {
  const keys = await allowedFeatureKeys(userId);
  return keys.includes(featureKey);
}


/**
 * Can this person use this feature right now?
 *
 * The single server-side answer: role clears the baseline, or the feature was
 * handed to them. A page's baseline comes from the access-level selector
 * (page_permissions) so an admin editing it there changes this too.
 */
export async function userCan(userId: number | null | undefined, userRole: string, featureKey: string): Promise<boolean> {
  if (userRole === "admin") return true;

  const def = featureByKey(featureKey);
  let baselineMinRole: Role | undefined;
  if (def?.kind === "page" && def.page) {
    baselineMinRole = (await getPageMinRoles()).get(def.page);
  }

  const grantedKeys = userId ? await allowedFeatureKeys(userId) : [];
  return decideAccess({ userRole, grantedKeys, featureKey, baselineMinRole });
}

/**
 * Route guard for anything a grant can open up.
 *
 * Use instead of requireAdmin/requireManagerOrAdmin on an endpoint behind a
 * registry feature — otherwise the screen renders for the person you granted
 * it to and every save comes back 403.
 */
export function requireFeature(featureKey: string) {
  return async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    const userId = req.session.userId;
    let role = req.session.userRole as string | undefined;
    if (!role && userId) {
      const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
      role = user?.role;
      if (role) req.session.userRole = role as "admin" | "manager" | "viewer";
    }
    if (role && (await userCan(userId, role, featureKey))) { next(); return; }
    const name = featureByKey(featureKey)?.name ?? featureKey;
    res.status(403).json({ error: `You don't have access to ${name}. An admin can grant it in Settings → Team & Access.` });
  };
}

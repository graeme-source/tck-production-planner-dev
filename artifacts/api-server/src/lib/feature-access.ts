import { db, appFeaturesTable, appSettingsTable, featureGrantsTable, trainingMatrixItemsTable, trainingRecordsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

// Feature-grant access checks (schema: lib/db/src/schema/features.ts).
// Pure decision logic split out so it's unit-testable; DB lookups thin.

export const SOP_GATE_SETTING_KEY = "feature_sop_gate_enforced";

/** Page routes unlocked by a feature grant, for role-fallback checks. */
export const PAGE_FEATURES: Record<string, string> = {
  "/fulfilment": "apc_label_printing",
};

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

/**
 * Loads / saves the production safety margin (app_settings). The rule itself
 * is the shared pure package @workspace/plan-margin. Objective C.
 */
import { db, appSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { PLAN_MARGIN_SETTING_KEYS, parsePlanMarginSettings, type PlanMarginSettings } from "@workspace/plan-margin";

export async function loadPlanMarginSettings(): Promise<PlanMarginSettings> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, Object.values(PLAN_MARGIN_SETTING_KEYS)));
  const map = new Map(rows.map(r => [r.key, r.value]));
  return parsePlanMarginSettings({
    smallMarginPacks: map.get(PLAN_MARGIN_SETTING_KEYS.smallMarginPacks) ?? null,
    largeMarginPacks: map.get(PLAN_MARGIN_SETTING_KEYS.largeMarginPacks) ?? null,
    largeBatchThreshold: map.get(PLAN_MARGIN_SETTING_KEYS.largeBatchThreshold) ?? null,
  });
}

export async function savePlanMarginSettings(s: PlanMarginSettings): Promise<void> {
  for (const [key, value] of [
    [PLAN_MARGIN_SETTING_KEYS.smallMarginPacks, String(s.smallMarginPacks)],
    [PLAN_MARGIN_SETTING_KEYS.largeMarginPacks, String(s.largeMarginPacks)],
    [PLAN_MARGIN_SETTING_KEYS.largeBatchThreshold, String(s.largeBatchThreshold)],
  ] as const) {
    await db.insert(appSettingsTable).values({ key, value })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
  }
}

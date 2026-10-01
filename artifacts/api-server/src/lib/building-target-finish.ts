/**
 * The builders' target finish for one plan — loads the inputs and hands them
 * to the pure computeTargetFinish (@workspace/production-schedule). Feeds the
 * small "Target finish" chip on both building tables.
 *
 * Every input is an existing setting, so the chip can't disagree with the
 * rest of the app:
 *   - start: Settings "building_start_time" (the day schedule's start)
 *   - breaks: the run rate's standard deductions (getStandardBreakConfig:
 *     break / lunch minutes + the restart allowance) at the plan's break
 *     anchors (schedule_break_anchors_<planId>, dragged on the mixing
 *     station's timeline), else the default ~09:15 / ~12:15
 *   - batches: calzone batches planned for the building line (the same items
 *     the day schedule times — mac cheese and fried chicken have their own
 *     stations)
 *   - rate: BUILDING_TARGET_BATCHES_PER_HOUR, both tables together
 */
import { db, productionPlansTable, productionPlanItemsTable, recipesTable, appSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  computeTargetFinish, applySavedBreakAnchors, parseClock, formatClock,
  DEFAULT_START_TIME, BUILDING_TARGET_BATCHES_PER_HOUR,
} from "@workspace/production-schedule";
import { getStandardBreakConfig } from "./batches-per-hour";
import { isOnDayTimeline } from "./timing-health";

export interface BuildingTargetFinish {
  planId: number;
  batches: number;
  ratePerHour: number;
  startTime: string;
  /** "HH:MM" London wall clock; null when nothing is planned for building. */
  targetFinish: string | null;
  breaksAdded: string[];
}

/** Null when the plan doesn't exist. */
export async function buildingTargetFinish(planId: number): Promise<BuildingTargetFinish | null> {
  const [plan] = await db
    .select({ id: productionPlansTable.id })
    .from(productionPlansTable)
    .where(eq(productionPlansTable.id, planId))
    .limit(1);
  if (!plan) return null;

  const items = await db
    .select({ batchesTarget: productionPlanItemsTable.batchesTarget, category: recipesTable.category })
    .from(productionPlanItemsTable)
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));
  const batches = items
    .filter(i => isOnDayTimeline(i.category))
    .reduce((s, i) => s + Math.max(0, Number(i.batchesTarget) || 0), 0);

  const anchorKey = `schedule_break_anchors_${planId}`;
  const settingRows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, ["building_start_time", anchorKey]));
  const settings = new Map(settingRows.map(s => [s.key, s.value]));
  const startMinutes = parseClock(settings.get("building_start_time") ?? DEFAULT_START_TIME)
    ?? parseClock(DEFAULT_START_TIME)!;

  const std = await getStandardBreakConfig();
  const breaks = applySavedBreakAnchors([
    { id: "morning", anchorMinutes: std.morning.anchorMinutes, minutes: std.morning.minutes + std.allowanceMinutes },
    { id: "lunch", anchorMinutes: std.lunch.anchorMinutes, minutes: std.lunch.minutes + std.allowanceMinutes },
  ], settings.get(anchorKey));

  const result = computeTargetFinish({ batches, startMinutes, breaks, ratePerHour: BUILDING_TARGET_BATCHES_PER_HOUR });
  return {
    planId,
    batches,
    ratePerHour: BUILDING_TARGET_BATCHES_PER_HOUR,
    startTime: formatClock(startMinutes),
    targetFinish: result ? formatClock(result.finishMinutes) : null,
    breaksAdded: result?.breaksAdded ?? [],
  };
}

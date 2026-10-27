/**
 * Measured build time per recipe, from the building stations' own batch
 * history — the loading half of lib/timing-suggestions.ts
 * suggestBuildSeconds (pure, tested: seconds per batch for ONE builder,
 * from the gaps between a station's consecutive batch completions, breaks
 * and outliers dropped, at least five real batches).
 *
 * Shared by GET /api/timing-health (the Recipes page's "Timing data" card)
 * and the batch-profit report (services/prep-times-report.ts), so both read
 * the same evidence the same way. Corrections logged after the fact are
 * left out — they aren't real build pace.
 */
import { db, productionPlanItemsTable, batchCompletionsTable, stationBreaksTable } from "@workspace/db";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { suggestBuildSeconds, type TimingSuggestion } from "../lib/timing-suggestions";

export const BUILDING_STATIONS = ["building_1", "building_2"];

/** How far back build pace is read: recent enough to reflect today's team
 *  and recipes. */
export const BUILD_HISTORY_DAYS = 56;

/** Build seconds per batch for ONE builder, per recipe id, from batches
 *  completed since `since` (recipes without enough history are absent). */
export async function loadBuildSuggestions(since: Date): Promise<Map<number, TimingSuggestion>> {
  const completions = await db
    .select({
      recipeId: productionPlanItemsTable.recipeId,
      planId: productionPlanItemsTable.planId,
      planItemId: batchCompletionsTable.planItemId,
      stationType: batchCompletionsTable.stationType,
      completedAt: batchCompletionsTable.completedAt,
    })
    .from(batchCompletionsTable)
    .innerJoin(productionPlanItemsTable, eq(productionPlanItemsTable.id, batchCompletionsTable.planItemId))
    .where(and(
      inArray(batchCompletionsTable.stationType, BUILDING_STATIONS),
      gte(batchCompletionsTable.completedAt, since),
      isNull(batchCompletionsTable.correctionByUserId),
    ));
  const breaks = await db
    .select({
      planId: stationBreaksTable.planId,
      stationType: stationBreaksTable.stationType,
      startedAt: stationBreaksTable.startedAt,
      endedAt: stationBreaksTable.endedAt,
    })
    .from(stationBreaksTable)
    .where(and(
      inArray(stationBreaksTable.stationType, BUILDING_STATIONS),
      gte(stationBreaksTable.startedAt, new Date(since.getTime() - 86_400_000)),
    ));
  return suggestBuildSeconds(
    completions.map(c => ({
      recipeId: c.recipeId,
      planId: c.planId,
      planItemId: c.planItemId,
      stationType: c.stationType,
      completedAtMs: c.completedAt.getTime(),
    })),
    breaks.map(b => ({
      planId: b.planId,
      stationType: b.stationType,
      startMs: b.startedAt.getTime(),
      endMs: b.endedAt ? b.endedAt.getTime() : null,
    })),
  );
}

/**
 * The day schedule re-planned from the builders' real progress (Graeme,
 * 2026-10-27). Shared by GET /production-plans/:id/live-schedule (the Mixing
 * station timeline) and the put-in snapshot (lib/meat-put-in.ts), so the time
 * judged by the daily review is exactly the time the station was showing.
 * Only today's plan is live — any other day is its plan unchanged.
 */
import { db, productionPlanItemsTable, batchCompletionsTable, ovenEventsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { replanLive, measurePace, meatKey, type BuildTick, type LiveSchedule } from "@workspace/production-schedule";
import { buildPlanSchedule } from "./day-schedule";
import { londonDateString, londonMinuteOfDay } from "./london-time";

export const BUILDING_STATIONS = ["building_1", "building_2"];

export interface LiveScheduleResult extends LiveSchedule {
  planId: number;
  planDate: string;
  isToday: boolean;
}

/** Null when the plan doesn't exist. */
export async function buildLiveSchedule(planId: number, now: Date = new Date()): Promise<LiveScheduleResult | null> {
  const base = await buildPlanSchedule(planId);
  if (!base) return null;

  const isToday = String(base.planDate).slice(0, 10) === londonDateString(now);
  const itemIds = base.recipes.map(r => r.planItemId);

  const items = itemIds.length
    ? await db
        .select({ id: productionPlanItemsTable.id, markedAt: productionPlanItemsTable.builderMarkedCompleteAt })
        .from(productionPlanItemsTable)
        .where(inArray(productionPlanItemsTable.id, itemIds))
    : [];
  // Only batches up to `now` (so a past moment can be re-played exactly).
  const completionsAll = itemIds.length
    ? await db
        .select({ planItemId: batchCompletionsTable.planItemId, completedAt: batchCompletionsTable.completedAt })
        .from(batchCompletionsTable)
        .where(and(inArray(batchCompletionsTable.planItemId, itemIds), inArray(batchCompletionsTable.stationType, BUILDING_STATIONS)))
    : [];
  const completions = completionsAll.filter(c => new Date(c.completedAt).getTime() <= now.getTime());
  const oven = await db
    .select({ recipeId: ovenEventsTable.recipeId, ingredientId: ovenEventsTable.ingredientId, inAt: ovenEventsTable.ovenInAt })
    .from(ovenEventsTable)
    .where(and(eq(ovenEventsTable.planId, planId), isNotNull(ovenEventsTable.recipeId), isNotNull(ovenEventsTable.ingredientId)));

  const builtById = new Map<number, number>();
  for (const c of completions) builtById.set(c.planItemId, (builtById.get(c.planItemId) ?? 0) + 1);
  const progress = items.map(i => ({ planItemId: i.id, built: builtById.get(i.id) ?? 0, markedComplete: i.markedAt != null && new Date(i.markedAt).getTime() <= now.getTime() }));

  const ticks: BuildTick[] = isToday
    ? completions.map(c => ({ planItemId: c.planItemId, atMinutes: londonMinuteOfDay(new Date(c.completedAt)) }))
    : [];
  const pace = measurePace(ticks, new Map(base.recipes.map(r => [r.planItemId, r.minutesPerBatch])), base.options.buildersCount);
  const { coldMixBufferMinutes } = await import("./meat-daily-review-job");

  const live = replanLive({
    recipes: base.recipes,
    options: { ...base.options, breaks: base.breaks },
    progress: isToday ? progress : [],
    ticks,
    nowMinutes: isToday ? londonMinuteOfDay(now) : 0,
    pace,
    meatsStarted: new Set(oven.filter(o => new Date(o.inAt).getTime() <= now.getTime()).map(o => meatKey(o.recipeId!, o.ingredientId!))),
    coldMixBufferMinutes: await coldMixBufferMinutes(),
  });

  return { planId, planDate: String(base.planDate).slice(0, 10), isToday, ...live };
}

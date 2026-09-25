/**
 * GET /api/timing-health — every timing input the day schedule needs that is
 * missing (or no longer matches the floor), each with a suggested value from
 * real history. Feeds the "Timing data" card on the Recipes page.
 *
 * Read-only. Saving a suggestion goes through PUT /api/recipes/:id/build-time
 * or PUT /api/ingredients/:id/meat-timing when a manager taps "Use suggested".
 * Rules: lib/timing-health.ts (what counts as a gap) and
 * lib/timing-suggestions.ts (how history becomes a suggestion).
 */
import { Router, type IRouter } from "express";
import {
  db, recipesTable, ingredientsTable, productionPlansTable, productionPlanItemsTable,
  batchCompletionsTable, stationBreaksTable, ovenEventsTable,
} from "@workspace/db";
import { and, eq, gte, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { requireManagerOrAdmin } from "../middleware/roles";
import { rawMeatsForRecipe } from "../lib/day-schedule";
import { assembleTimingHealth, isOnDayTimeline, type HealthMeatInput } from "../lib/timing-health";
import { suggestBuildSeconds, suggestCookMinutes } from "../lib/timing-suggestions";

const router: IRouter = Router();

/** Build-time history window: recent enough to reflect today's team and recipes. */
export const BUILD_WINDOW_DAYS = 56;
/** Meat cooks are fewer per day, so look back further for enough trays. */
export const COOK_WINDOW_DAYS = 84;

const BUILDING_STATIONS = ["building_1", "building_2"];

router.get("/", requireManagerOrAdmin, async (_req, res) => {
  const buildSince = new Date(Date.now() - BUILD_WINDOW_DAYS * 86_400_000);
  const cookSince = new Date(Date.now() - COOK_WINDOW_DAYS * 86_400_000);
  const planSince = buildSince.toISOString().slice(0, 10);

  const recipes = await db
    .select({
      id: recipesTable.id,
      name: recipesTable.name,
      category: recipesTable.category,
      targetBuildSeconds: recipesTable.targetBuildSeconds,
      portionsPerBatch: recipesTable.portionsPerBatch,
    })
    .from(recipesTable);
  const timelineRecipes = recipes.filter(r => isOnDayTimeline(r.category));

  const plannedRows = await db
    .select({ recipeId: productionPlanItemsTable.recipeId, n: sql<number>`count(*)::int` })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlansTable.id, productionPlanItemsTable.planId))
    .where(gte(productionPlansTable.planDate, planSince))
    .groupBy(productionPlanItemsTable.recipeId);
  const timesPlanned = new Map(plannedRows.map(r => [r.recipeId, Number(r.n)]));

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
      gte(batchCompletionsTable.completedAt, buildSince),
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
      gte(stationBreaksTable.startedAt, new Date(buildSince.getTime() - 86_400_000)),
    ));
  const buildSuggestions = suggestBuildSeconds(
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

  // Raw meats the timeline depends on, from each timeline recipe's full tree.
  const usedBy = new Map<number, string[]>();
  for (const r of timelineRecipes) {
    for (const m of await rawMeatsForRecipe(r.id, r.portionsPerBatch ?? 10)) {
      const list = usedBy.get(m.rawMeatIngredientId) ?? [];
      if (!list.includes(r.name)) list.push(r.name);
      usedBy.set(m.rawMeatIngredientId, list);
    }
  }
  const meatIds = [...usedBy.keys()];
  const meatRows = meatIds.length
    ? await db
        .select({
          id: ingredientsTable.id,
          name: ingredientsTable.name,
          cook: ingredientsTable.estimatedCookTimeMin,
          process: ingredientsTable.meatProcessMinutes,
        })
        .from(ingredientsTable)
        .where(inArray(ingredientsTable.id, meatIds))
    : [];
  const ovenRows = meatIds.length
    ? await db
        .select({
          ingredientId: ovenEventsTable.ingredientId,
          ovenInAt: ovenEventsTable.ovenInAt,
          ovenOutAt: ovenEventsTable.ovenOutAt,
        })
        .from(ovenEventsTable)
        .where(and(
          inArray(ovenEventsTable.ingredientId, meatIds),
          isNotNull(ovenEventsTable.ovenOutAt),
          gte(ovenEventsTable.ovenInAt, cookSince),
        ))
    : [];
  const durationsByMeat = new Map<number, number[]>();
  for (const o of ovenRows) {
    if (o.ingredientId == null || !o.ovenOutAt) continue;
    const list = durationsByMeat.get(o.ingredientId) ?? [];
    list.push((o.ovenOutAt.getTime() - o.ovenInAt.getTime()) / 60_000);
    durationsByMeat.set(o.ingredientId, list);
  }
  const cookSuggestions = new Map(
    [...durationsByMeat]
      .map(([id, d]) => [id, suggestCookMinutes(d)] as const)
      .filter((e): e is readonly [number, NonNullable<ReturnType<typeof suggestCookMinutes>>] => e[1] != null),
  );

  const meats: HealthMeatInput[] = meatRows.map(m => ({
    ingredientId: m.id,
    name: m.name,
    cookMinutes: m.cook,
    processMinutes: m.process,
    usedBy: usedBy.get(m.id) ?? [],
  }));

  const health = assembleTimingHealth({
    recipes: recipes.map(r => ({
      recipeId: r.id,
      name: r.name,
      category: r.category,
      targetBuildSeconds: r.targetBuildSeconds,
      timesPlanned: timesPlanned.get(r.id) ?? 0,
    })),
    buildSuggestions,
    meats,
    cookSuggestions,
  });

  res.json({
    buildWindowDays: BUILD_WINDOW_DAYS,
    cookWindowDays: COOK_WINDOW_DAYS,
    ...health,
  });
});

export default router;

/**
 * The day's forward-looking build timeline for one plan — the body of
 * GET /api/production-plans/:id/schedule, moved out of routes/production-plans.ts
 * (charter rule 4) when missing-timing flags were added (2026-09-25).
 *
 * Walks the calzone building line in orderPosition, predicting each recipe's
 * start/finish from its expected minutes-per-batch (split across the builders),
 * inserts break cards, and back-calculates each recipe's "get the meat in by"
 * time from its raw meat's cook+process lead time. The heavy lifting is the
 * pure @workspace/production-schedule engine, shared with the client so drag
 * edits recompute identically in the browser. What to do about a missing input
 * is decided in the pure lib/timing-health.ts.
 */
import { db, productionPlansTable, productionPlanItemsTable, recipesTable, ingredientsTable, appSettingsTable } from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import {
  computeDaySchedule, parseClock, formatClock,
  DEFAULT_START_TIME, DEFAULT_CHANGEOVER_SECONDS, DEFAULT_BUILDERS,
  type ScheduleRecipeInput,
} from "@workspace/production-schedule";
import { resolveRecipeIngredients, aggregateIngredients } from "./ingredient-resolver";
import { meatLeadMinutes } from "./meat-lead-time";
import {
  isOnDayTimeline, typicalMinutesPerBatch, buildTimingFor, missingBuildTimeWarning,
  splitMeatsByTiming, type RecipeMeat,
} from "./timing-health";

/** Raw meats per recipe from the full ingredient tree (sub-recipes included). */
export async function rawMeatsForRecipe(recipeId: number, portionsPerBatch: number): Promise<RecipeMeat[]> {
  // Same source the Meat Cooking panels and the prep_meat station use, so the
  // schedule always agrees with the cooking screen on which meats a recipe needs.
  const resolved = await resolveRecipeIngredients(recipeId, portionsPerBatch, { skipToppings: true });
  const agg = aggregateIngredients(resolved);
  return [...agg.values()]
    .filter(i => i.category === "raw_meat")
    .map(m => ({ rawMeatIngredientId: m.ingredientId, rawMeatName: m.ingredientName }));
}

/** Null when the plan doesn't exist. */
export async function buildPlanSchedule(planId: number) {
  const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, planId)).limit(1);
  if (!plan) return null;

  // Plan items joined to recipe timing info, in build order.
  const items = await db
    .select({
      planItemId: productionPlanItemsTable.id,
      recipeId: recipesTable.id,
      name: recipesTable.name,
      category: recipesTable.category,
      orderPosition: productionPlanItemsTable.orderPosition,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      targetBuildSeconds: recipesTable.targetBuildSeconds,
      portionsPerBatch: recipesTable.portionsPerBatch,
    })
    .from(productionPlanItemsTable)
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId))
    .orderBy(asc(productionPlanItemsTable.orderPosition), asc(productionPlanItemsTable.id));

  // The timeline is the calzone building line (the two builders). Mac cheese
  // and fried chicken have their own stations, so they're excluded here.
  const buildItems = items.filter(i => isOnDayTimeline(i.category) && (i.batchesTarget ?? 0) > 0);

  const meatsByRecipe = new Map<number, RecipeMeat[]>();
  const allMeatIds = new Set<number>();
  for (const item of buildItems) {
    const meats = await rawMeatsForRecipe(item.recipeId, item.portionsPerBatch ?? 10);
    meatsByRecipe.set(item.recipeId, meats);
    meats.forEach(m => allMeatIds.add(m.rawMeatIngredientId));
  }
  const meatInfoRows = allMeatIds.size
    ? await db
        .select({ id: ingredientsTable.id, cook: ingredientsTable.estimatedCookTimeMin, process: ingredientsTable.meatProcessMinutes })
        .from(ingredientsTable)
        .where(inArray(ingredientsTable.id, [...allMeatIds]))
    : [];
  // Lead time = cook + process (lib/meat-lead-time.ts, migration 0124).
  const leadById = new Map(meatInfoRows.map(r => [r.id, meatLeadMinutes(r.cook, r.process)]));

  // Settings.
  const settingRows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, [
      "building_start_time", "changeover_seconds", "builders_count",
      "default_break_minutes", "default_lunch_minutes",
      `schedule_break_anchors_${planId}`,
    ]));
  const settings = new Map(settingRows.map(s => [s.key, s.value]));

  const startMinutes = parseClock(settings.get("building_start_time") ?? DEFAULT_START_TIME) ?? parseClock(DEFAULT_START_TIME)!;
  const changeoverSeconds = Number(settings.get("changeover_seconds") ?? DEFAULT_CHANGEOVER_SECONDS) || DEFAULT_CHANGEOVER_SECONDS;
  const buildersCount = Number(settings.get("builders_count") ?? DEFAULT_BUILDERS) || DEFAULT_BUILDERS;
  const morningMins = Number(settings.get("default_break_minutes") ?? 15) || 15;
  const lunchMins = Number(settings.get("default_lunch_minutes") ?? 35) || 35;

  // Default anchors ~09:15 / ~12:15; a station drag persists per-plan overrides
  // in app_settings (schedule_break_anchors_<planId> = {"morning":555,...}).
  const breaks = [
    { id: "morning", label: "Morning break", minutes: morningMins, anchorMinutes: 9 * 60 + 15 },
    { id: "lunch", label: "Lunch", minutes: lunchMins, anchorMinutes: 12 * 60 + 15 },
  ];
  const savedAnchors = settings.get(`schedule_break_anchors_${planId}`);
  if (savedAnchors) {
    try {
      const parsed = JSON.parse(savedAnchors) as Record<string, number>;
      for (const br of breaks) {
        if (Number.isFinite(parsed[br.id])) br.anchorMinutes = parsed[br.id];
      }
    } catch {
      // Malformed saved anchors — fall back to defaults rather than 500.
    }
  }

  // A recipe with no build time is timed at the day's typical per-batch time
  // (flagged as a guess) rather than 0 — see lib/timing-health.ts.
  const typical = typicalMinutesPerBatch(buildItems.map(i => (i.targetBuildSeconds ?? 0) / 60));

  const warnings: string[] = [];
  const engineRecipes: ScheduleRecipeInput[] = buildItems.map(i => {
    const timing = buildTimingFor(i.targetBuildSeconds, typical);
    if (timing.guessed) warnings.push(missingBuildTimeWarning(i.name, typical));
    const split = splitMeatsByTiming(i.name, meatsByRecipe.get(i.recipeId) ?? [], leadById);
    warnings.push(...split.warnings);
    return {
      planItemId: i.planItemId,
      recipeId: i.recipeId,
      name: i.name,
      batches: i.batchesTarget,
      minutesPerBatch: timing.minutesPerBatch,
      meats: split.timed,
      buildTimeGuessed: timing.guessed,
      untimedMeats: split.untimed,
    };
  });

  const schedule = computeDaySchedule(engineRecipes, { startMinutes, buildersCount, changeoverSeconds, breaks });

  // Interleave recipes + breaks into a single ordered timeline, formatting all
  // wall-clock times to "HH:MM" for the client.
  const recipeRows = schedule.recipes.map(r => ({
    type: "recipe" as const,
    planItemId: r.planItemId,
    recipeId: r.recipeId,
    name: r.name,
    start: formatClock(r.startMinutes),
    finish: formatClock(r.finishMinutes),
    startMinutes: r.startMinutes,
    buildMinutes: r.buildMinutes,
    buildTimeGuessed: r.buildTimeGuessed,
    meats: r.meats.map(m => ({
      rawMeatIngredientId: m.rawMeatIngredientId,
      name: m.rawMeatName,
      processMinutes: m.processMinutes,
      cookStart: formatClock(m.cookStartMinutes),
      cookStartMinutes: m.cookStartMinutes,
      beforeShiftStart: m.beforeShiftStart,
      missing: m.missing,
    })),
    untimedMeats: r.untimedMeats,
  }));
  const breakRows = schedule.breaks.map(b => ({
    type: "break" as const,
    id: b.id,
    label: b.label,
    minutes: b.minutes,
    start: formatClock(b.startMinutes),
    finish: formatClock(b.finishMinutes),
    startMinutes: b.startMinutes,
  }));
  const timeline = [...recipeRows, ...breakRows].sort((a, b) => a.startMinutes - b.startMinutes);

  return {
    planId,
    planName: plan.name,
    planDate: plan.planDate,
    startTime: formatClock(startMinutes),
    endTime: formatClock(schedule.endMinutes),
    changeoverSeconds,
    buildersCount,
    breaks: breaks.map(b => ({ id: b.id, label: b.label, minutes: b.minutes, anchorMinutes: b.anchorMinutes })),
    timeline,
    warnings: [...new Set(warnings)],
    // Raw engine inputs so the client can recompute instantly when a break card
    // is dragged, without another round-trip. Mirrors @workspace/production-schedule.
    recipes: engineRecipes,
    options: { startMinutes, buildersCount, changeoverSeconds },
  };
}

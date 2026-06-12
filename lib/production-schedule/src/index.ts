// Forward-looking production timeline for a single day's build plan.
//
// Given a start time and the day's recipes (in build order), this predicts when
// each recipe starts and finishes, and — for recipes that use meat — the latest
// time the meat must go in to cook+process so it's ready when building starts.
//
// The whole calc is wall-clock only: every time is an integer "minutes since
// midnight" in the kitchen's local clock (07:00 = 420). There are no Date
// objects and no timezones here on purpose — a day's schedule is just arithmetic
// on a wall clock, and keeping it that way makes it trivial to test and reason
// about. The API layer parses the "HH:MM" start-time setting into minutes,
// runs this, and formats the results back to "HH:MM" for display.
//
// Model (agreed with Graeme):
//   per-recipe build time = batches × (minutesPerBatch ÷ buildersCount)
//   two builders split each recipe, so a 5-min/batch recipe lands a batch
//   every 2.5 min. A fixed changeover gap sits between consecutive recipes.
//   Break cards (morning/lunch) are inserted between recipes near their anchor
//   time and push everything after them later. Meat cook-start works backwards
//   from each recipe's predicted start by its raw meat's process time.

export const DEFAULT_CHANGEOVER_SECONDS = 90;
export const DEFAULT_BUILDERS = 2;
export const DEFAULT_START_TIME = "07:00";

/** Default break cards: morning 15 min ~09:15, lunch 35 min ~12:15. */
export const DEFAULT_BREAKS: ScheduleBreakInput[] = [
  { id: "morning", label: "Morning break", minutes: 15, anchorMinutes: 9 * 60 + 15 },
  { id: "lunch", label: "Lunch", minutes: 35, anchorMinutes: 12 * 60 + 15 },
];

export interface ScheduleMeatInput {
  rawMeatIngredientId: number;
  rawMeatName: string;
  /** Cook + processing minutes for this raw meat. */
  processMinutes: number;
}

export interface ScheduleRecipeInput {
  planItemId: number;
  recipeId: number;
  name: string;
  /** Batches still planned for the day (batchesTarget). */
  batches: number;
  /** Expected minutes for ONE builder to build one batch (targetBuildSeconds ÷ 60). */
  minutesPerBatch: number;
  /** Raw meats this recipe uses (0+). Empty for veg recipes. */
  meats?: ScheduleMeatInput[];
}

export interface ScheduleBreakInput {
  /** Stable id — 'morning' | 'lunch' | a custom card id. */
  id: string;
  label: string;
  minutes: number;
  /**
   * Where the card wants to sit, in minutes since midnight. The engine drops it
   * in just before the first recipe that would otherwise start at/after this
   * time, so it "floats" to roughly the right point in the running order. The
   * UI lets the user drag it, which just changes this anchor.
   */
  anchorMinutes: number;
}

export interface ScheduleOptions {
  /** Building start time, minutes since midnight (07:00 = 420). */
  startMinutes: number;
  /** Number of builders splitting each recipe. */
  buildersCount: number;
  changeoverSeconds: number;
  breaks: ScheduleBreakInput[];
}

export interface ScheduledMeat {
  rawMeatIngredientId: number;
  rawMeatName: string;
  processMinutes: number;
  /** Latest the meat must go in to be ready for this recipe's start. */
  cookStartMinutes: number;
  /** True when cookStart lands before the building start time (do it first thing / night before). */
  beforeShiftStart: boolean;
}

export interface ScheduledRecipe {
  planItemId: number;
  recipeId: number;
  name: string;
  startMinutes: number;
  finishMinutes: number;
  buildMinutes: number;
  meats: ScheduledMeat[];
}

export interface ScheduledBreak {
  id: string;
  label: string;
  minutes: number;
  startMinutes: number;
  finishMinutes: number;
  /** Index in the recipes array this break follows (-1 = before any recipe). */
  afterRecipeIndex: number;
}

export interface DaySchedule {
  startMinutes: number;
  endMinutes: number;
  recipes: ScheduledRecipe[];
  breaks: ScheduledBreak[];
}

/** Build time for a recipe in whole minutes, rounded to the nearest minute. */
function recipeBuildMinutes(recipe: ScheduleRecipeInput, buildersCount: number): number {
  const builders = Math.max(1, buildersCount);
  const perBatch = Math.max(0, recipe.minutesPerBatch) / builders;
  return Math.round(Math.max(0, recipe.batches) * perBatch);
}

/**
 * Compute the day's timeline. Recipes are taken in the order given (caller sorts
 * by orderPosition). Breaks are placed by anchor time between recipes.
 */
export function computeDaySchedule(
  recipes: ScheduleRecipeInput[],
  options: ScheduleOptions,
): DaySchedule {
  const changeoverMinutes = Math.max(0, options.changeoverSeconds) / 60;
  const pendingBreaks = [...options.breaks].sort((a, b) => a.anchorMinutes - b.anchorMinutes);
  const placedBreaks: ScheduledBreak[] = [];
  const scheduledRecipes: ScheduledRecipe[] = [];

  let clock = options.startMinutes;

  const drainBreaksDueBy = (afterRecipeIndex: number) => {
    while (pendingBreaks.length > 0 && pendingBreaks[0].anchorMinutes <= clock) {
      const br = pendingBreaks.shift()!;
      placedBreaks.push({
        id: br.id,
        label: br.label,
        minutes: br.minutes,
        startMinutes: clock,
        finishMinutes: clock + br.minutes,
        afterRecipeIndex,
      });
      clock += br.minutes;
    }
  };

  recipes.forEach((recipe, index) => {
    // Changeover gap before every recipe except the first.
    if (index > 0) clock += changeoverMinutes;

    // Any break whose anchor has passed slots in here, between recipes.
    drainBreaksDueBy(index - 1);

    const buildMinutes = recipeBuildMinutes(recipe, options.buildersCount);
    const startMinutes = clock;
    const finishMinutes = startMinutes + buildMinutes;

    const meats: ScheduledMeat[] = (recipe.meats ?? []).map((m) => ({
      rawMeatIngredientId: m.rawMeatIngredientId,
      rawMeatName: m.rawMeatName,
      processMinutes: m.processMinutes,
      cookStartMinutes: startMinutes - m.processMinutes,
      beforeShiftStart: startMinutes - m.processMinutes < options.startMinutes,
    }));

    scheduledRecipes.push({
      planItemId: recipe.planItemId,
      recipeId: recipe.recipeId,
      name: recipe.name,
      startMinutes,
      finishMinutes,
      buildMinutes,
      meats,
    });

    clock = finishMinutes;
  });

  // Any breaks anchored past the end of production land after the last recipe.
  drainBreaksDueBy(recipes.length - 1);

  return {
    startMinutes: options.startMinutes,
    endMinutes: clock,
    recipes: scheduledRecipes,
    breaks: placedBreaks,
  };
}

/**
 * One ordered position on the timeline: either a recipe or a break card. This
 * is the shape the interactive UI works in — the user drags break slots up and
 * down the list, and we recompute from the new order with no round-trip.
 */
export type ScheduleSlot =
  | { kind: "recipe"; recipe: ScheduleRecipeInput }
  | { kind: "break"; break: ScheduleBreakInput };

/**
 * Compute the timeline from an explicit ordered list of slots. Unlike
 * computeDaySchedule (which auto-places breaks by anchor time), this honours the
 * exact order given — so it's what the client calls after a drag. Changeover is
 * added before every recipe except the first, matching the auto-placed default.
 */
export function computeScheduleFromSlots(
  slots: ScheduleSlot[],
  options: ScheduleOptions,
): DaySchedule {
  const changeoverMinutes = Math.max(0, options.changeoverSeconds) / 60;
  const scheduledRecipes: ScheduledRecipe[] = [];
  const placedBreaks: ScheduledBreak[] = [];
  let clock = options.startMinutes;
  let recipeCount = 0;
  let lastRecipeIndex = -1;

  for (const slot of slots) {
    if (slot.kind === "recipe") {
      if (recipeCount > 0) clock += changeoverMinutes;
      const recipe = slot.recipe;
      const buildMinutes = recipeBuildMinutes(recipe, options.buildersCount);
      const startMinutes = clock;
      const finishMinutes = startMinutes + buildMinutes;
      const meats: ScheduledMeat[] = (recipe.meats ?? []).map((m) => ({
        rawMeatIngredientId: m.rawMeatIngredientId,
        rawMeatName: m.rawMeatName,
        processMinutes: m.processMinutes,
        cookStartMinutes: startMinutes - m.processMinutes,
        beforeShiftStart: startMinutes - m.processMinutes < options.startMinutes,
      }));
      scheduledRecipes.push({
        planItemId: recipe.planItemId,
        recipeId: recipe.recipeId,
        name: recipe.name,
        startMinutes,
        finishMinutes,
        buildMinutes,
        meats,
      });
      clock = finishMinutes;
      recipeCount += 1;
      lastRecipeIndex = scheduledRecipes.length - 1;
    } else {
      const br = slot.break;
      placedBreaks.push({
        id: br.id,
        label: br.label,
        minutes: br.minutes,
        startMinutes: clock,
        finishMinutes: clock + br.minutes,
        afterRecipeIndex: lastRecipeIndex,
      });
      clock += br.minutes;
    }
  }

  return { startMinutes: options.startMinutes, endMinutes: clock, recipes: scheduledRecipes, breaks: placedBreaks };
}

/** "07:00" → 420. Returns null on malformed input. */
export function parseClock(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 420 → "07:00". Wraps/normalises negative or >24h values into 24h clock. */
export function formatClock(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const wrapped = ((rounded % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

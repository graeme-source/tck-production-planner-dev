/**
 * Timing-data health: which inputs the day schedule needs are missing (or no
 * longer match the floor), what the schedule does about each one, and what to
 * say on screen. Pure — no DB — so every rule here is unit-tested.
 *
 * Why (Graeme, 2026-09-25): "if we don't have a cooking time on something and
 * we're not factoring it into production, then that's an issue." Earlier that
 * week Philly Cheesesteak 2.0 had no build time, the engine counted it as 0
 * minutes and the next recipe was placed two minutes later — silently.
 *
 * The rules:
 *  - A recipe with no build time is timed at the day's typical build time (the
 *    median per-batch time of the other recipes on the schedule) instead of 0,
 *    and flagged "timing is a guess". Zero was never a guess — it was wrong.
 *  - A raw meat missing one of cook/process time keeps the half it has (as
 *    lib/meat-lead-time.ts always did) but the half-known flag now reaches the
 *    card, because its "start cooking by" time is later than it should be.
 *  - A raw meat missing both can't be given a start time at all. It used to
 *    vanish from the card; now it's listed on the card as "No cook time set".
 */
import { meatLeadMinutes, meatLeadWarning, type MeatLead } from "./meat-lead-time";
import type { TimingSuggestion } from "./timing-suggestions";

/**
 * The day timeline is the two builders on the calzone line. Two categories are
 * made elsewhere and never belong on it:
 *  - Mac cheese — its own station, tracked in packs.
 *  - Fried chicken — its own fried_chicken station (no batch has ever been
 *    logged on a building station), one bag per "batch". Before 2026-09-25 it
 *    sat on the timeline at 0 minutes, which only cost a phantom changeover;
 *    timed at a typical calzone rate it would have added hours to the day.
 * (Same strings as routes/fried-chicken.ts and the MAC_CHEESE_CATEGORY copies;
 * redeclared because this module must stay DB-free for its tests. Charter
 * rule 8 bent, as everywhere else that splits by station today.)
 */
export const MAC_CHEESE_CATEGORY = "Macaroni Cheese";
export const FRIED_CHICKEN_CATEGORY = "Fried Chicken";

export function isOnDayTimeline(category: string | null | undefined): boolean {
  return category !== MAC_CHEESE_CATEGORY && category !== FRIED_CHICKEN_CATEGORY;
}

// ── Build time ───────────────────────────────────────────────────────────────

/** Median of the known per-batch minutes; 0 when nothing is known. */
export function typicalMinutesPerBatch(knownMinutes: number[]): number {
  const known = knownMinutes.filter((m) => Number.isFinite(m) && m > 0).sort((a, b) => a - b);
  if (known.length === 0) return 0;
  const mid = Math.floor(known.length / 2);
  return known.length % 2 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
}

export interface BuildTiming {
  minutesPerBatch: number;
  guessed: boolean;
}

export function buildTimingFor(targetBuildSeconds: number | null | undefined, fallbackMinutes: number): BuildTiming {
  if (targetBuildSeconds != null && Number.isFinite(targetBuildSeconds) && targetBuildSeconds > 0) {
    return { minutesPerBatch: targetBuildSeconds / 60, guessed: false };
  }
  return { minutesPerBatch: fallbackMinutes, guessed: true };
}

export function missingBuildTimeWarning(recipeName: string, fallbackMinutes: number): string {
  if (fallbackMinutes <= 0) return `${recipeName}: no build time set — counted as 0 min, so the times after it are too early`;
  const shown = Math.round(fallbackMinutes * 10) / 10;
  return `${recipeName}: no build time set — timed at a typical ${shown} min a batch (a guess)`;
}

// ── Meat lead time ───────────────────────────────────────────────────────────

export interface RecipeMeat {
  rawMeatIngredientId: number;
  rawMeatName: string;
}

export interface MeatTimingSplit {
  /** Meats with at least one of cook/process set — they get a start time. */
  timed: Array<RecipeMeat & { processMinutes: number; missing: "cook" | "process" | null }>;
  /** Meats with neither set — no start time possible, shown flagged. */
  untimed: RecipeMeat[];
  warnings: string[];
}

export function splitMeatsByTiming(
  recipeName: string,
  meats: RecipeMeat[],
  leadById: Map<number, MeatLead>,
): MeatTimingSplit {
  const out: MeatTimingSplit = { timed: [], untimed: [], warnings: [] };
  for (const m of meats) {
    const lead = leadById.get(m.rawMeatIngredientId) ?? meatLeadMinutes(null, null);
    const warning = meatLeadWarning(recipeName, m.rawMeatName, lead);
    if (warning) out.warnings.push(warning);
    if (lead.minutes == null) {
      out.untimed.push({ rawMeatIngredientId: m.rawMeatIngredientId, rawMeatName: m.rawMeatName });
    } else {
      out.timed.push({
        ...m,
        processMinutes: lead.minutes,
        missing: lead.missing === "both" ? null : lead.missing,
      });
    }
  }
  return out;
}

// ── Health list ──────────────────────────────────────────────────────────────

/** A set value that differs from the floor by this fraction or more is flagged to check. */
export const STALE_FRACTION = 0.2;
/** …but only on this much evidence — a handful of batches can't overrule a set value. */
export const STALE_MIN_SAMPLES = 10;

export interface HealthRecipeInput {
  recipeId: number;
  name: string;
  category: string | null;
  targetBuildSeconds: number | null;
  /** Times on a plan in the lookback window — how much the gap matters. */
  timesPlanned: number;
}

export interface HealthMeatInput {
  ingredientId: number;
  name: string;
  cookMinutes: number | null;
  processMinutes: number | null;
  /** Names of the day-timeline recipes that use it (whole ingredient tree). Empty → not listed. */
  usedBy: string[];
}

export interface RecipeTimingIssue {
  recipeId: number;
  name: string;
  category: string | null;
  kind: "missing" | "check";
  currentSeconds: number | null;
  timesPlanned: number;
  suggestion: TimingSuggestion | null;
}

export interface MeatTimingIssue {
  ingredientId: number;
  name: string;
  usedBy: string[];
  kind: "missing" | "check";
  /** Which of the two lead-time inputs are unset (null when both are set). */
  missing: "cook" | "process" | "both" | null;
  cookMinutes: number | null;
  processMinutes: number | null;
  /** Suggested cook time from oven-in/out history. Process time can't be inferred. */
  cookSuggestion: TimingSuggestion | null;
}

export function differsFromFloor(current: number, suggestion: TimingSuggestion | null | undefined): boolean {
  if (!suggestion || suggestion.samples < STALE_MIN_SAMPLES || current <= 0) return false;
  return Math.abs(suggestion.value - current) / current >= STALE_FRACTION;
}

export function assembleTimingHealth(input: {
  recipes: HealthRecipeInput[];
  buildSuggestions: Map<number, TimingSuggestion>;
  meats: HealthMeatInput[];
  cookSuggestions: Map<number, TimingSuggestion>;
}): {
  recipes: RecipeTimingIssue[];
  meats: MeatTimingIssue[];
  /** No build time, but not on any plan in the window — listed quietly, not as a to-do. */
  notPlannedRecently: Array<{ recipeId: number; name: string }>;
} {
  const recipes: RecipeTimingIssue[] = [];
  const notPlannedRecently: Array<{ recipeId: number; name: string }> = [];
  for (const r of input.recipes) {
    // Only what the day timeline uses: a mac cheese or fried chicken build
    // time never moves a start time, so it isn't a timing-data gap.
    if (!isOnDayTimeline(r.category)) continue;
    const suggestion = input.buildSuggestions.get(r.recipeId) ?? null;
    const set = r.targetBuildSeconds != null && r.targetBuildSeconds > 0;
    const kind = !set ? "missing" : differsFromFloor(r.targetBuildSeconds!, suggestion) ? "check" : null;
    if (!kind) continue;
    if (kind === "missing" && r.timesPlanned === 0 && !suggestion) {
      notPlannedRecently.push({ recipeId: r.recipeId, name: r.name });
      continue;
    }
    recipes.push({
      recipeId: r.recipeId,
      name: r.name,
      category: r.category,
      kind,
      currentSeconds: set ? r.targetBuildSeconds : null,
      timesPlanned: r.timesPlanned,
      suggestion,
    });
  }
  // Missing before check; the ones that hit the schedule most often first.
  recipes.sort((a, b) =>
    (a.kind === "missing" ? 0 : 1) - (b.kind === "missing" ? 0 : 1) ||
    b.timesPlanned - a.timesPlanned ||
    a.name.localeCompare(b.name));

  const meats: MeatTimingIssue[] = [];
  for (const m of input.meats) {
    if (m.usedBy.length === 0) continue;
    const lead = meatLeadMinutes(m.cookMinutes, m.processMinutes);
    const cookSuggestion = input.cookSuggestions.get(m.ingredientId) ?? null;
    const kind = lead.missing
      ? "missing"
      : differsFromFloor(m.cookMinutes!, cookSuggestion) ? "check" : null;
    if (!kind) continue;
    meats.push({
      ingredientId: m.ingredientId,
      name: m.name,
      usedBy: m.usedBy,
      kind,
      missing: lead.missing,
      cookMinutes: lead.missing === "cook" || lead.missing === "both" ? null : m.cookMinutes,
      processMinutes: lead.missing === "process" || lead.missing === "both" ? null : m.processMinutes,
      cookSuggestion,
    });
  }
  meats.sort((a, b) =>
    (a.kind === "missing" ? 0 : 1) - (b.kind === "missing" ? 0 : 1) ||
    b.usedBy.length - a.usedBy.length ||
    a.name.localeCompare(b.name));

  notPlannedRecently.sort((a, b) => a.name.localeCompare(b.name));
  return { recipes, meats, notPlannedRecently };
}

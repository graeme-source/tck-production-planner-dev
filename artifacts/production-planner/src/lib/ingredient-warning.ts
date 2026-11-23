/**
 * Ingredient station warnings on the Mixing and Building screens (Fix queue
 * #404, Dave Bewsey; Graeme approved 20 Nov 2026). Objective D.
 *
 * A manager writes a warning on an ingredient ("Please be vigilant for
 * bones…"); every recipe that uses it pops the warning up when the recipe
 * is opened — once per person, per recipe, per day, so it is read each
 * morning without nagging on every tap. Which recipes carry a warning comes
 * from GET /api/ingredient-station-warnings; this file is the "have they
 * already seen it today" rule. Pure — the pop-up
 * (components/ingredient-warning-popup.tsx) does the storage.
 */

export interface StationWarning {
  ingredientId: number;
  ingredientName: string;
  warning: string;
}

export interface StationWarningsResponse {
  byRecipe: Record<string, StationWarning[]>;
  byIngredient: Record<string, string>;
}

export const STATION_WARNINGS_KEY = ["ingredient-station-warnings"] as const;
export const SEEN_STORAGE_KEY = "ingredient_warning_seen_v1";
export const STATION_WARNING_MAX = 500;

/** What the browser remembers: one London day and who has seen what on it. */
export interface SeenToday { day: string; keys: string[] }

function seenKey(userId: number, recipeId: number, warnings: StationWarning[]): string {
  // The wording is part of the key: a changed warning is shown again.
  const text = warnings.map(w => `${w.ingredientId}:${w.warning}`).join("|");
  return `${userId}/${recipeId}/${text}`;
}

export function parseSeen(raw: string | null | undefined): SeenToday | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SeenToday>;
    if (typeof v.day === "string" && Array.isArray(v.keys)) return { day: v.day, keys: v.keys.filter(k => typeof k === "string") };
  } catch { /* unreadable = nothing seen */ }
  return null;
}

/** The warnings to pop up now, or [] when there are none or this person has seen them today. */
export function warningsToShow(args: {
  warnings: StationWarning[] | undefined;
  recipeId: number | null | undefined;
  userId: number;
  today: string;
  seen: SeenToday | null;
}): StationWarning[] {
  const { warnings, recipeId, userId, today, seen } = args;
  if (recipeId == null || !warnings || warnings.length === 0) return [];
  if (seen && seen.day === today && seen.keys.includes(seenKey(userId, recipeId, warnings))) return [];
  return warnings;
}

/** The record after this person taps "Got it". Yesterday's ticks are dropped. */
export function markSeen(seen: SeenToday | null, args: { warnings: StationWarning[]; recipeId: number; userId: number; today: string }): SeenToday {
  const keys = seen && seen.day === args.today ? seen.keys : [];
  const key = seenKey(args.userId, args.recipeId, args.warnings);
  return { day: args.today, keys: keys.includes(key) ? keys : [...keys, key] };
}

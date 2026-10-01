/**
 * Slow-meat tray limit (Graeme, 2026-10-01).
 *
 * The kitchen can only cook a fixed number of trays of SLOW meat for one
 * production plan (11 today). "Slow" is a property of the ingredient, never a
 * name: any ingredient whose estimated cook time is at or above a threshold
 * (120 minutes today — the pork for pulled pork and the slow-cooked beefs).
 *
 * Trays are counted exactly the way the Raw Meat prep station lays them out
 * (GET /production-plans/:id/prep-requirements-by-recipe): for each plan
 * line and each slow meat in it, the raw meat kg plus the marinade kg that
 * go on its trays, divided by that ingredient's raw-meat kg per tray,
 * rounded UP. Trays never mix meats, and the station keeps each recipe's
 * trays separate (different marinades), so the count is per line per meat.
 *
 * Pure logic only — shared by the Create Plan screen (live counter + capped
 * suggestions) and the API (the server-side check at plan save), so the two
 * can never disagree.
 */

export const SLOW_MEAT_SETTING_KEYS = {
  minCookMinutes: "slow_meat_min_cook_minutes",
  trayLimit: "slow_meat_tray_limit",
} as const;

export const DEFAULT_SLOW_MEAT_MIN_COOK_MINUTES = 120;
export const DEFAULT_SLOW_MEAT_TRAY_LIMIT = 11;

export interface SlowMeatSettings {
  /** Cook time (minutes) at or above which a meat counts as slow. */
  minCookMinutes: number;
  /** Most slow-meat trays one production plan may need. */
  trayLimit: number;
}

/** Parse the two app settings, falling back to the defaults for anything
 *  missing or nonsensical. */
export function parseSlowMeatSettings(raw: { minCookMinutes?: string | null; trayLimit?: string | null }): SlowMeatSettings {
  const cook = Number(raw.minCookMinutes);
  const limit = Number(raw.trayLimit);
  return {
    minCookMinutes: raw.minCookMinutes != null && raw.minCookMinutes !== "" && Number.isFinite(cook) && cook > 0
      ? cook : DEFAULT_SLOW_MEAT_MIN_COOK_MINUTES,
    trayLimit: raw.trayLimit != null && raw.trayLimit !== "" && Number.isFinite(limit) && limit >= 0
      ? Math.floor(limit) : DEFAULT_SLOW_MEAT_TRAY_LIMIT,
  };
}

/** One meat used by a recipe, with what ONE batch puts on trays. */
export interface RecipeMeatUse {
  ingredientId: number;
  ingredientName: string;
  cookTimeMin: number | null;
  /** Raw-meat kg per tray for this ingredient; null = not set. */
  trayCapacityKg: number | null;
  /** Raw meat kg + marinade kg on trays for one batch of the recipe. */
  kgPerBatch: number;
}

export interface RecipeMeatProfile {
  recipeId: number;
  recipeName: string;
  meats: RecipeMeatUse[];
}

export interface PlanLine {
  recipeId: number;
  batches: number;
  /** Fixed lines (queued test production) count toward the limit but are
   *  never reduced by the cap. */
  fixed?: boolean;
}

export function isSlowMeat(cookTimeMin: number | null | undefined, minCookMinutes: number): boolean {
  return cookTimeMin != null && cookTimeMin >= minCookMinutes;
}

const EPS = 1e-9;

/** Trays for a weight of one meat. Weight is taken to the gram first so
 *  floating-point noise can never tip an exact fit onto an extra tray. */
export function traysFor(kg: number, trayCapacityKg: number): number {
  if (kg <= 0 || trayCapacityKg <= 0) return 0;
  const grams = Math.round(kg * 1000);
  return Math.ceil(grams / 1000 / trayCapacityKg - EPS);
}

export interface SlowMeatIngredientTrays {
  ingredientId: number;
  ingredientName: string;
  kg: number;
  trays: number;
  trayCapacityKg: number | null;
}

export interface SlowMeatTrayCount {
  totalTrays: number;
  trayLimit: number;
  minCookMinutes: number;
  overLimit: boolean;
  /** Slow meats in use, trays summed across lines (largest first). */
  byIngredient: SlowMeatIngredientTrays[];
  /** Trays per recipe line that uses slow meat. */
  byRecipe: Array<{ recipeId: number; recipeName: string; batches: number; trays: number }>;
  /** Slow meats in use with no kg-per-tray set — cannot be counted, so
   *  they are flagged instead of guessed. */
  missingTraySize: Array<{ ingredientId: number; ingredientName: string; recipeNames: string[] }>;
}

function profileMap(profiles: RecipeMeatProfile[]): Map<number, RecipeMeatProfile> {
  return new Map(profiles.map(p => [p.recipeId, p]));
}

/** Trays one line needs (slow meats with a tray size only). */
function lineTrays(profile: RecipeMeatProfile | undefined, batches: number, minCookMinutes: number): number {
  if (!profile || batches <= 0) return 0;
  let trays = 0;
  for (const m of profile.meats) {
    if (!isSlowMeat(m.cookTimeMin, minCookMinutes) || m.trayCapacityKg == null || m.trayCapacityKg <= 0) continue;
    trays += traysFor(m.kgPerBatch * batches, m.trayCapacityKg);
  }
  return trays;
}

export function countSlowMeatTrays(
  profiles: RecipeMeatProfile[],
  lines: PlanLine[],
  settings: SlowMeatSettings,
): SlowMeatTrayCount {
  const byId = profileMap(profiles);
  const ing = new Map<number, SlowMeatIngredientTrays>();
  const missing = new Map<number, { ingredientId: number; ingredientName: string; recipeNames: string[] }>();
  const byRecipe: SlowMeatTrayCount["byRecipe"] = [];
  let totalTrays = 0;

  for (const line of lines) {
    const profile = byId.get(line.recipeId);
    if (!profile || line.batches <= 0) continue;
    let recipeTrays = 0;
    let usesSlow = false;
    for (const m of profile.meats) {
      if (!isSlowMeat(m.cookTimeMin, settings.minCookMinutes) || m.kgPerBatch <= 0) continue;
      usesSlow = true;
      const kg = m.kgPerBatch * line.batches;
      if (m.trayCapacityKg == null || m.trayCapacityKg <= 0) {
        const e = missing.get(m.ingredientId) ?? { ingredientId: m.ingredientId, ingredientName: m.ingredientName, recipeNames: [] };
        if (!e.recipeNames.includes(profile.recipeName)) e.recipeNames.push(profile.recipeName);
        missing.set(m.ingredientId, e);
        continue;
      }
      const trays = traysFor(kg, m.trayCapacityKg);
      recipeTrays += trays;
      const e = ing.get(m.ingredientId) ?? { ingredientId: m.ingredientId, ingredientName: m.ingredientName, kg: 0, trays: 0, trayCapacityKg: m.trayCapacityKg };
      e.kg += kg;
      e.trays += trays;
      ing.set(m.ingredientId, e);
    }
    if (usesSlow) byRecipe.push({ recipeId: profile.recipeId, recipeName: profile.recipeName, batches: line.batches, trays: recipeTrays });
    totalTrays += recipeTrays;
  }

  return {
    totalTrays,
    trayLimit: settings.trayLimit,
    minCookMinutes: settings.minCookMinutes,
    overLimit: totalTrays > settings.trayLimit,
    byIngredient: [...ing.values()]
      .map(e => ({ ...e, kg: Math.round(e.kg * 100) / 100 }))
      .sort((a, b) => b.trays - a.trays || a.ingredientName.localeCompare(b.ingredientName)),
    byRecipe,
    missingTraySize: [...missing.values()],
  };
}

export interface SlowMeatReduction {
  recipeId: number;
  recipeName: string;
  from: number;
  to: number;
}

export interface SlowMeatCapResult {
  /** Same order and length as the input; batches capped where needed. */
  lines: PlanLine[];
  reductions: SlowMeatReduction[];
  before: SlowMeatTrayCount;
  after: SlowMeatTrayCount;
}

/**
 * Cap suggested batches so the plan's slow-meat trays stay within the limit.
 *
 * Fair reduction: every line that puts slow meat on trays is scaled down by
 * the same factor (the largest factor that fits), rounded DOWN to whole
 * batches; then batches are added back one at a time — always to the line
 * with the biggest shortfall against its original suggestion — while the
 * plan still fits. Lines without slow meat, and fixed lines, never change.
 * Under the limit, everything is returned untouched.
 */
export function capSlowMeatBatches(
  profiles: RecipeMeatProfile[],
  lines: PlanLine[],
  settings: SlowMeatSettings,
): SlowMeatCapResult {
  const before = countSlowMeatTrays(profiles, lines, settings);
  const unchanged = (): SlowMeatCapResult => ({ lines: lines.map(l => ({ ...l })), reductions: [], before, after: before });
  if (!before.overLimit) return unchanged();

  const byId = profileMap(profiles);
  const orig = lines.map(l => Math.max(0, Math.floor(l.batches)));
  const adjustable = lines
    .map((l, i) => i)
    .filter(i => !lines[i].fixed && orig[i] > 0 && lineTrays(byId.get(lines[i].recipeId), orig[i], settings.minCookMinutes) > 0);
  if (adjustable.length === 0) return unchanged();

  const totalFor = (batches: number[]): number =>
    lines.reduce((s, l, i) => s + lineTrays(byId.get(l.recipeId), batches[i], settings.minCookMinutes), 0);
  const scaled = (f: number): number[] =>
    orig.map((b, i) => (adjustable.includes(i) ? Math.floor(b * f + EPS) : b));

  // Largest common scale factor that fits (trays only grow with the factor).
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (totalFor(scaled(mid)) <= settings.trayLimit) lo = mid; else hi = mid;
  }
  const current = scaled(lo);

  // Add back one batch at a time to the biggest shortfall that still fits.
  for (;;) {
    const order = adjustable
      .filter(i => current[i] < orig[i])
      .sort((a, b) => (orig[b] - current[b]) - (orig[a] - current[a]) || orig[b] - orig[a] || a - b);
    let added = false;
    for (const i of order) {
      current[i] += 1;
      if (totalFor(current) <= settings.trayLimit) { added = true; break; }
      current[i] -= 1;
    }
    if (!added) break;
  }

  const capped = lines.map((l, i) => ({ ...l, batches: adjustable.includes(i) ? current[i] : l.batches }));
  const reductions: SlowMeatReduction[] = [];
  for (const i of adjustable) {
    if (current[i] < orig[i]) {
      reductions.push({ recipeId: lines[i].recipeId, recipeName: byId.get(lines[i].recipeId)?.recipeName ?? `Recipe #${lines[i].recipeId}`, from: orig[i], to: current[i] });
    }
  }
  return { lines: capped, reductions, before, after: countSlowMeatTrays(profiles, capped, settings) };
}

/** "BBQ Pulled Pork reduced 30 → 24 batches, Philly 20 → 16, to stay within
 *  11 trays (Pork 6, Diced Beef 5)". Empty string when nothing was cut. */
export function describeSlowMeatReductions(result: Pick<SlowMeatCapResult, "reductions" | "after">): string {
  if (result.reductions.length === 0) return "";
  const parts = result.reductions.map((r, i) =>
    i === 0 ? `${r.recipeName} reduced ${r.from} → ${r.to} batches` : `${r.recipeName} ${r.from} → ${r.to}`);
  const split = result.after.byIngredient.map(m => `${m.ingredientName} ${m.trays}`).join(", ");
  return `${parts.join(", ")}, to stay within ${result.after.trayLimit} trays${split ? ` (${split})` : ""}`;
}

/**
 * Server-side save rule. A plan whose slow meat is over the limit may not be
 * saved — except that an EXISTING plan that is already over may still be
 * edited, as long as the edit doesn't add slow-meat trays (so fixing a typo
 * in its notes, or trimming batches, never gets blocked).
 */
export function checkSlowMeatSave(input: {
  after: SlowMeatTrayCount;
  before?: SlowMeatTrayCount | null;
}): { ok: true } | { ok: false; message: string } {
  const { after, before } = input;
  if (!after.overLimit) return { ok: true };
  if (before && after.totalTrays <= before.totalTrays) return { ok: true };
  const split = after.byIngredient.map(m => `${m.ingredientName} ${m.trays}`).join(", ");
  return {
    ok: false,
    message: `Too much slow-cooked meat: this plan needs ${after.totalTrays} trays${split ? ` (${split})` : ""} but the limit is ${after.trayLimit}. Reduce the batches of ${after.byRecipe.filter(r => r.trays > 0).map(r => r.recipeName).join(" or ")} and try again.`,
  };
}

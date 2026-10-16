/**
 * Which kitchen a plan item belongs to — THE rule every production KPI uses
 * to decide what it counts (Objective E: one honest set of numbers).
 *
 * The main kitchen makes calzones (counted in batches) and mac cheese
 * (counted in packs). Fried chicken is made in a DIFFERENT facility by its own
 * people and is "completely separate from all of our normal KPIs — keep this
 * as if fried chicken wasn't in the system" (Graeme, 2026-10-05). Before this
 * rule, most totals split "mac cheese" from "everything else", so fried
 * chicken bags were counted as calzone batches (the dashboard read "82 / 259"
 * on a 105-batch day).
 *
 * Production KPIs only: fried chicken stays on its own station, in plans'
 * item lists, ordering/stock, and every sales/revenue figure.
 *
 * Category strings live here and nowhere else in KPI logic. Only the named
 * exceptions are pulled out, so a new calzone-line category (desserts, a new
 * range) still counts as main kitchen without a code change. Pure — safe for
 * the server and the browser.
 */
export const MAC_CHEESE_CATEGORY = "Macaroni Cheese";
export const FRIED_CHICKEN_CATEGORY = "Fried Chicken";

/** calzone = the calzone line (batches); mac = mac cheese (packs);
 *  separate = made in another facility, outside every production KPI. */
export type KitchenLine = "calzone" | "mac" | "separate";

export function kitchenLine(category: string | null | undefined): KitchenLine {
  if (category === MAC_CHEESE_CATEGORY) return "mac";
  if (category === FRIED_CHICKEN_CATEGORY) return "separate";
  return "calzone";
}

/** True for anything the main kitchen makes (calzone line or mac cheese). */
export function isMainKitchen(category: string | null | undefined): boolean {
  return kitchenLine(category) !== "separate";
}

/** Plan items the main kitchen makes — for station screens and totals that
 *  read API plan items (which carry `recipeCategory`). */
export function mainKitchenItems<T extends { recipeCategory?: string | null }>(items: readonly T[]): T[] {
  return items.filter(it => isMainKitchen(it.recipeCategory));
}

/** Split a list three ways by kitchen line, keeping each group's order —
 *  for documents that list everything but total each line separately. */
export function splitByKitchenLine<T>(items: readonly T[], categoryOf: (t: T) => string | null | undefined): Record<KitchenLine, T[]> {
  const out: Record<KitchenLine, T[]> = { calzone: [], mac: [], separate: [] };
  for (const it of items) out[kitchenLine(categoryOf(it))].push(it);
  return out;
}

/** Main-kitchen batches planned against the 110/80 day capacity: calzone
 *  batches + mac cheese packs, one for one — the long-standing meaning —
 *  except a recipe with its own capacity equivalence (recipes
 *  .calzone_batch_equivalent, migration 0202: one bun batch ≈ 3.33 calzone
 *  batches), which counts batches × that. Rounded to 2 dp. */
export function mainKitchenBatches(items: ReadonlyArray<{ category: string | null | undefined; batchesTarget: number | string | null | undefined; calzoneBatchEquivalent?: number | string | null }>): number {
  const total = items
    .filter(i => isMainKitchen(i.category))
    .reduce((s, i) => {
      const eq = i.calzoneBatchEquivalent;
      const factor = eq === null || eq === undefined || eq === "" || !Number.isFinite(Number(eq)) ? 1 : Number(eq);
      return s + (Number(i.batchesTarget) || 0) * factor;
    }, 0);
  return Math.round(total * 100) / 100;
}

/** Calzone-line batches planned — the target behind the stations' "all done"
 *  checks and calzone totals. Mac cheese (packs) and the separate facility
 *  are both left out. */
export function calzoneLineBatches(items: ReadonlyArray<{ category: string | null | undefined; batchesTarget: number | string | null | undefined }>): number {
  return items
    .filter(i => kitchenLine(i.category) === "calzone")
    .reduce((s, i) => s + (Number(i.batchesTarget) || 0), 0);
}

/** Keep only main-kitchen entries of a per-category record (e.g. a team
 *  efficiency day's lines keyed by recipe category). */
export function mainKitchenLines<V>(byCategory: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [cat, v] of Object.entries(byCategory)) if (isMainKitchen(cat)) out[cat] = v;
  return out;
}

/** Rota positions that work for a separate facility, read from the founder's
 *  "which positions belong to which line" setting (team efficiency
 *  line_positions, keyed by recipe category — e.g. Frying and Breading under
 *  Fried Chicken). Lower-cased and trimmed for matching Planday position
 *  names. Positions of lines the main kitchen makes are never included. */
export function separateKitchenPositions(linePositions: Record<string, readonly string[]> | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const [cat, names] of Object.entries(linePositions ?? {})) {
    if (isMainKitchen(cat)) continue;
    for (const n of names) {
      const key = n.trim().toLowerCase();
      if (key) out.add(key);
    }
  }
  return out;
}

/**
 * Building checklist grouping: everything that goes INSIDE first, then an
 * "On top" section for every recipe line flagged as a topping
 * (recipe_ingredients.is_topping / recipe_sub_recipes.is_topping).
 *
 * Driven purely by the flag — never by position. The previous version only
 * drew the "On top" divider when the toppings happened to sit at the very
 * end of the saved assembly order, so the section silently vanished whenever
 * a topping sorted earlier: recipes with no saved order sort by name
 * ("Cracked Black Pepper" before "Mozzarella"), and BBQ Pulled Pork has
 * Rosemary twice (inside + on top) which always share one saved order
 * because the order is saved per ingredient, not per recipe line.
 */

export interface AssemblyEntryLike {
  isFilling: boolean;
  ai?: { isTopping?: boolean };
}

/** True for a topping line (the filling itself is never a topping). */
export function isToppingEntry(e: AssemblyEntryLike): boolean {
  return !e.isFilling && !!e.ai?.isTopping;
}

/** Split into inside/on-top, keeping the saved order within each group. */
export function splitToppings<T extends AssemblyEntryLike>(entries: T[]): { inside: T[]; onTop: T[] } {
  const inside: T[] = [];
  const onTop: T[] = [];
  for (const e of entries) (isToppingEntry(e) ? onTop : inside).push(e);
  return { inside, onTop };
}

/** Grams to a builder-readable string: small amounts keep their decimals
 *  (a topping is often 0.2 g per item), bigger ones round to whole grams. */
export function formatGrams(g: number): string {
  const v = Math.max(0, g);
  if (v === 0) return "0 g";
  const dp = v < 1 ? 2 : v < 10 ? 1 : 0;
  return `${Number(v.toFixed(dp))} g`;
}

/** Per-item and per-batch quantity for a topping row. `weightPerBatch` is
 *  what the assembly endpoint sends (grams per portion × portions per
 *  batch), so dividing by portions per batch gives the amount on each item. */
export function toppingQuantities(weightPerBatch: number, portionsPerBatch: number): { perItem: string; perBatch: string } {
  const ppb = portionsPerBatch > 0 ? portionsPerBatch : 1;
  return { perItem: formatGrams(weightPerBatch / ppb), perBatch: formatGrams(weightPerBatch) };
}

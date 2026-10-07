/**
 * 8-pack bags on hand vs bags needed (pure — display/suggestion only).
 *
 * Bags in the production fridge are real stock (Graeme, 2026-10-07), so
 * where the app asks for bags to be made it shows how many are already in
 * the fridge and suggests making only the shortfall. Nothing here changes
 * a plan — the operator decides.
 */

/** Bags still to make once the fridge's bags are used. Never negative. */
export function bagShortfall(needed: number, onHand: number): number {
  const n = Math.max(0, Math.trunc(needed) || 0);
  const h = Math.max(0, Math.trunc(onHand) || 0);
  return Math.max(0, n - h);
}

export interface BagNeed {
  /** Caller's id for the line (e.g. order + line id). */
  key: string;
  recipeId: number;
  bags: number;
}

export interface BagAllocation {
  /** Bags this line can take from the fridge. */
  fromFridge: number;
  /** Bags still to make for this line. */
  toMake: number;
}

/**
 * Share the fridge's bags across several needs in the order given, so two
 * orders for the same recipe can't both be told the same bags are there.
 */
export function allocateBagsOnHand(needs: BagNeed[], onHand: Map<number, number>): Map<string, BagAllocation> {
  const left = new Map<number, number>();
  for (const [recipeId, n] of onHand) left.set(recipeId, Math.max(0, Math.trunc(n) || 0));
  const out = new Map<string, BagAllocation>();
  for (const need of needs) {
    const want = Math.max(0, Math.trunc(need.bags) || 0);
    const have = left.get(need.recipeId) ?? 0;
    const fromFridge = Math.min(want, have);
    left.set(need.recipeId, have - fromFridge);
    out.set(need.key, { fromFridge, toMake: want - fromFridge });
  }
  return out;
}

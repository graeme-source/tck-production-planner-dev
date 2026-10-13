/**
 * Today's factory count (pure — no DB).
 *
 * "The count" is the Factory Number update the packing/wrapping teams do in
 * Stock Control → Production fridge (the "Update Factory Number" button on
 * Packing): a counted 2-pack level per product. Each counted product leaves
 * a `fridge_stock_changes` row with source 'manual' — including a zero-delta
 * "counted, no change" row, so a product whose number was already right
 * still shows as counted.
 *
 * The products expected in the count are the ones the Production fridge
 * panel lists for counting: every core-menu recipe plus any recipe holding
 * 2-pack stock there. 8-pack bags are not part of the factory number.
 */

export interface CountProduct {
  recipeId: number;
  name: string;
}

export interface FactoryCountStatus {
  /** Products expected in today's count. */
  expected: number;
  /** Of those, how many have a manual count recorded today. */
  counted: number;
  /** Products still to count today (expected − counted). */
  outstanding: number;
  /** True once every expected product has been counted today. */
  complete: boolean;
  /** The products still to count, by name. */
  missing: CountProduct[];
}

/** Products expected in the count: core-menu recipes ∪ recipes with a
 *  positive 2-pack fridge level, deduplicated by recipe id. */
export function expectedCountProducts(
  coreMenu: readonly CountProduct[],
  stocked: readonly CountProduct[],
): CountProduct[] {
  const byId = new Map<number, CountProduct>();
  for (const p of [...coreMenu, ...stocked]) if (!byId.has(p.recipeId)) byId.set(p.recipeId, p);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function factoryCountStatus(
  expected: readonly CountProduct[],
  countedRecipeIds: Iterable<number>,
): FactoryCountStatus {
  const counted = new Set(countedRecipeIds);
  const missing = expected.filter(p => !counted.has(p.recipeId));
  return {
    expected: expected.length,
    counted: expected.length - missing.length,
    outstanding: missing.length,
    complete: missing.length === 0,
    missing,
  };
}

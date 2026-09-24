/**
 * Where a linked (marinade-for) ingredient's stock check lives on the Raw
 * Meat station.
 *
 * A linked ingredient belongs to the raw meat it is linked to, inside the
 * recipe that links it — e.g. an ingredient attached to a meat inside a
 * slow-cook sub-recipe counts under that meat's panel on that recipe, and
 * nowhere else. The earlier version kept a page-level catch-all built from
 * EVERY recipe's links minus the open recipe's, so opening any other recipe
 * dumped those checks at the bottom of the page, outside every panel
 * (Graeme, 2026-09-24).
 *
 * Everything here is driven by the recipe payload's own links
 * (`rawMeatIngredientId` on each marinade row) — no names.
 */

export interface LinkedRow {
  rawMeatIngredientId: number;
  marinadeIngredientId: number | null;
  /** Missing = prep-day (older payloads didn't send the flag). */
  addAtCooking?: boolean;
}

export interface MeatStockCheckIds {
  /** Linked ingredients added on prep day — counted once the meat's trays
   *  are done. */
  afterPrep: number[];
  /** Linked ingredients held back to go in at cooking — counted beside the
   *  hold-back row, nothing on this station to wait for. */
  heldBack: number[];
}

export interface RecipeLinkedStockChecks {
  /** Per raw-meat ingredient id in the recipe. */
  byMeat: Map<number, MeatStockCheckIds>;
  /** Links in THIS recipe whose meat isn't one of the recipe's raw-meat rows
   *  (a stale link) — still this recipe's, so they render at the foot of
   *  this recipe's panel rather than vanishing. Never another recipe's. */
  unplaced: number[];
}

/**
 * Split one recipe's linked-ingredient stock checks between that recipe's
 * raw-meat panels. Only the given recipe's rows are considered, so nothing
 * from another recipe can leak in. Each ingredient id appears at most once
 * per recipe (the first meat that links it keeps it), so two inputs for the
 * same count never render side by side.
 */
export function linkedStockChecksForRecipe(
  rawMeatIngredientIds: number[],
  links: LinkedRow[],
): RecipeLinkedStockChecks {
  const byMeat = new Map<number, MeatStockCheckIds>();
  for (const id of rawMeatIngredientIds) byMeat.set(id, { afterPrep: [], heldBack: [] });

  const placed = new Set<number>();
  const unplaced: number[] = [];

  // Prep-day links claim first, so an ingredient linked both ways is counted
  // after the trays rather than before.
  const ordered = [...links.filter(l => !l.addAtCooking), ...links.filter(l => l.addAtCooking)];
  for (const l of ordered) {
    const id = l.marinadeIngredientId;
    if (id == null || placed.has(id)) continue;
    placed.add(id);
    const meat = byMeat.get(l.rawMeatIngredientId);
    if (!meat) { unplaced.push(id); continue; }
    (l.addAtCooking ? meat.heldBack : meat.afterPrep).push(id);
  }

  return { byMeat, unplaced };
}

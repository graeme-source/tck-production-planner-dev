/**
 * Raw Meat station trays per meat for one recipe run — the figure the
 * station shows and ticks (fix-queue #320, 22 Oct 2026).
 *
 * stationRawMeatTrays (lib/stock-usage-rules.ts) is the pure rule; GET /production-plans/:id/
 * prep-requirements-by-recipe calls it with the rows it already built, and
 * loadRawMeatTrays rebuilds those same rows (same resolver, same rounding,
 * same marinade loader) for the Orders page's "still to prep" and the
 * running-stock ledger, so all three count the same trays.
 */
import { aggregateIngredients, resolveRecipeIngredients, roundByUnit } from "./ingredient-resolver";
import { loadRawMeatMarinades } from "./raw-meat-marinades";
import { stationRawMeatTrays, type TrayMeatRow } from "./stock-usage-rules";

/** Trays per raw meat for one plan item, exactly as the Raw Meat station
 *  computes them. Only raw_meat-category ingredients appear in the map. */
export async function loadRawMeatTrays(input: {
  recipeId: number;
  portionsPerBatch: number;
  batchesTarget: number;
}): Promise<Map<number, number | null>> {
  const { recipeId, portionsPerBatch, batchesTarget } = input;
  if (!(batchesTarget > 0)) return new Map();
  const resolved = await resolveRecipeIngredients(recipeId, portionsPerBatch, { skipToppings: true, mixExtraBatches: batchesTarget });
  const meats: TrayMeatRow[] = [];
  for (const ing of aggregateIngredients(resolved).values()) {
    if (ing.category !== "raw_meat") continue;
    const cooked = ing.quantityPerBatch * batchesTarget;
    const raw = ing.processingRatio ? cooked / ing.processingRatio : cooked;
    meats.push({
      ingredientId: ing.ingredientId,
      isRawMeat: true,
      unit: ing.unit,
      rawQty: roundByUnit(raw, ing.unit),
      rawMeatTrayCapacityKg: ing.rawMeatTrayCapacityKg != null ? Number(ing.rawMeatTrayCapacityKg) : null,
    });
  }
  if (meats.length === 0) return new Map();
  const marinades = await loadRawMeatMarinades({
    recipeId,
    portionsPerBatch,
    batchesTarget,
    includeMixExtra: true,
    // The station's own figure for the legacy grams-per-kg table.
    legacyRawMeatKgFor: id => (meats.find(m => m.ingredientId === id)?.rawQty ?? 0) / 1000,
  });
  return stationRawMeatTrays(meats, marinades);
}

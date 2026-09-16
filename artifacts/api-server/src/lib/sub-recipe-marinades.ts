/**
 * Scaling for marinade components that live INSIDE a sub-recipe.
 *
 * A recipe uses `subUsagePerPortion` of a sub-recipe whose components total
 * `subYield` in the same unit. A marinade component inside that sub (36g of
 * onions marinading the diced beef) therefore contributes
 *   componentQty × subUsagePerPortion / subYield
 * per portion of the recipe — identical arithmetic to the ingredient
 * resolver, kept pure here so the marinade panel and prep placement can be
 * regression-tested against the Philly restructure that motivated it
 * (2026-09-17).
 */

export interface SubMarinadeScale {
  /** Component quantity inside the sub-recipe, in its own units. */
  componentQty: number;
  /** How much of the sub-recipe one recipe portion uses (yield units). */
  subUsagePerPortion: number;
  /** The sub-recipe's yield in the same units as subUsagePerPortion. */
  subYield: number;
}

/** The component's contribution per recipe PORTION, in its own units. */
export function subMarinadeQtyPerPortion(s: SubMarinadeScale): number {
  if (s.subYield <= 0) return 0;
  return s.componentQty * (s.subUsagePerPortion / s.subYield);
}

/** Total grams across a run, converting kg-unit components. */
export function subMarinadeTotalGrams(
  s: SubMarinadeScale & { unit: string | null; portionsPerBatch: number; batchesTarget: number },
): number {
  const perPortion = subMarinadeQtyPerPortion(s);
  const total = perPortion * s.portionsPerBatch * s.batchesTarget;
  const grams = (s.unit ?? "kg").toLowerCase() === "kg" || (s.unit ?? "").toLowerCase() === "l"
    ? total * 1000
    : total;
  return Math.round(grams);
}

/**
 * What one built portion actually weighs — the oven station's target-weight
 * basis (Graeme, 2026-09-16).
 *
 * The old basis summed every RAW recipe quantity, so anything that reduces
 * in cooking (the Philly's stock and marinade components) inflated the
 * target: Philly packs targeted ~700g while the builders demonstrably place
 * 302g per portion (97g cooked filling + 60g mozzarella + 30g nacho cheese
 * + 115g dough), i.e. a 604g pack.
 *
 * The corrected basis is what the BUILDERS put in: the filling mix (recipe
 * quantities for filling-mix rows are the made filling's weight) less the
 * builder's display trim, plus the pre-oven assembly items, plus the dough
 * — divided by portions per batch. Marinade components (cooked into the
 * filling), post-oven finishes (garlic butter, icing) and the tray are the
 * caller's concern to exclude/add.
 */

export interface BuiltPortionInput {
  /** Made filling per batch, in grams (filling-mix rows × portions per batch). */
  fillingGramsPerBatch: number;
  /** The builders' per-batch display trim (recipes.builder_filling_deduction_grams). */
  builderFillingDeductionGrams: number;
  /** Pre-oven assembly items per batch, in grams (cheeses, toppings — not dough, not post-oven finishes). */
  assemblyGramsPerBatch: number;
  /** Dough per portion, in grams. */
  doughGramsPerPortion: number;
  portionsPerBatch: number;
}

export function builtPortionWeightG(input: BuiltPortionInput): number {
  const ppb = Math.max(1, input.portionsPerBatch);
  const placedPerBatch =
    Math.max(0, input.fillingGramsPerBatch - Math.max(0, input.builderFillingDeductionGrams)) +
    Math.max(0, input.assemblyGramsPerBatch);
  return Math.round(placedPerBatch / ppb + Math.max(0, input.doughGramsPerPortion));
}

/** The pack target the oven-station scale checks against. */
export function builtPackTargetWeightG(portionWeightG: number, packSize: number, trayWeightG: number): number {
  return Math.round(Math.max(1, packSize) * portionWeightG + Math.max(0, trayWeightG));
}

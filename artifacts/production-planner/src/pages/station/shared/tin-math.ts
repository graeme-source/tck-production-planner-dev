/** How many mixing tins count as complete, given batches mixed so far.
 *  Extracted from the mixing station's getTinInfo so the zero guards are
 *  testable: an item with batchesTarget 0 used to produce
 *  floor(0 / 0) = NaN and poison the day's tin totals into "NaN/36"
 *  (found on live, 2026-09-16). */
export function tinsCompleteFrom(mixed: number, tinsTarget: number, batchesPerTinEven: number): number {
  if (tinsTarget <= 0 || batchesPerTinEven <= 0) return 0;
  return Math.min(Math.floor(mixed / batchesPerTinEven), tinsTarget);
}

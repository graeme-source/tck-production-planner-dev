/**
 * Smallest worthwhile mac cheese run (Graeme, 2026-10-09): "There's no point
 * making 8 packs. It's not worth spending all the time. We might as well
 * just make 15." Any recipe the plan says to make SOME of (1–14 packs) is
 * rounded up to 15; zero stays zero, so a recipe stops being made once stock
 * covers sales. Per recipe, before rounding up to whole batches.
 */
export const MAC_CHEESE_MIN_PACKS = 15;

export function applyMacCheeseMinimum(rawPacks: number, minimum: number = MAC_CHEESE_MIN_PACKS): number {
  if (!Number.isFinite(rawPacks) || rawPacks <= 0) return 0;
  return Math.max(rawPacks, minimum);
}

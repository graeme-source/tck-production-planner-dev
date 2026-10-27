/**
 * A recipe's pack size (portions per pack) may be left blank (migration
 * 0286; Graeme, 27 Oct 2026): "for fried chicken, we'll just leave it
 * blank". Blank means one thing only — the website gets nutrition per 100 g
 * and no per-portion figures. Everywhere else (planning, packs, wrapping,
 * costing, labels, QUID, Shopify) a blank pack size behaves exactly as 1,
 * which is what those recipes held before. Read it through these helpers,
 * never a scattered `?? 1`. Objective B.
 */

/** Whether the recipe has a pack size set (not blank). */
export function hasPackSize(packSize: number | string | null | undefined): boolean {
  return packSize != null && String(packSize).trim() !== "";
}

/** The pack size the kitchen maths uses: blank counts as 1. */
export function effectivePackSize(packSize: number | string | null | undefined): number {
  return hasPackSize(packSize) ? Number(packSize) : 1;
}

/** What a recipe save stores: null (sent blank) stays blank; not sent at all
 *  defaults to 1, as it always has. */
export function packSizeToStore(packSize: number | null | undefined): string | null {
  if (packSize === null) return null;
  return String(packSize ?? 1);
}

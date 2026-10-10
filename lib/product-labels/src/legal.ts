/**
 * UK FIC (retained Reg. 1169/2011) Article 13(2)/(3) and Annex IV: the
 * mandatory particulars must be printed with an x-height of at least 1.2 mm,
 * or 0.9 mm when the pack's largest surface is under 80 cm².
 *
 * x-height is a property of the typeface, not the point size: Barlow's "x"
 * is 0.506 of the em, so 1.2 mm of x-height needs a 2.37 mm em = 6.72 pt.
 * The ratio is read from the bundled font file itself (fonts.ts), so a
 * different font gets its own correct minimum. All text on the label is
 * treated as mandatory — the minimum applies to every field.
 */
import { mmToPt } from "@workspace/units";

export const MIN_X_HEIGHT_MM = 1.2;
export const MIN_X_HEIGHT_SMALL_PACK_MM = 0.9;

/** Sizes step in quarter points; the minimum is rounded UP to the next step
 *  so rounding can never take text under the legal line. */
export const PT_STEP = 0.25;

export function requiredXHeightMm(smallPack: boolean): number {
  return smallPack ? MIN_X_HEIGHT_SMALL_PACK_MM : MIN_X_HEIGHT_MM;
}

/** Smallest point size (quarter-point steps) whose x-height meets the law. */
export function legalMinPt(xHeightRatio: number, smallPack: boolean): number {
  if (!(xHeightRatio > 0)) throw new Error("Font has no x-height");
  const exact = mmToPt(requiredXHeightMm(smallPack) / xHeightRatio);
  return Math.ceil(exact / PT_STEP - 1e-9) * PT_STEP;
}

/** The x-height in mm that a size actually prints at. */
export function xHeightMmAt(pt: number, xHeightRatio: number): number {
  return (pt / 72) * 25.4 * xHeightRatio;
}

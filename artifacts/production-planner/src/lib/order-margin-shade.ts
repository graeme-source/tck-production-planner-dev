/**
 * The Margin cell's shade on the order table (Graeme, 24 Nov 2026: "a
 * gradient colour scale … so I can very quickly see whether or not it's a
 * good or a bad order"). Gross margin ÷ the target margin on the same
 * dark-red → yellow → green → teal scale as the Numbers and Ads pages; a
 * loss-making order is the darkest red.
 */
import { shadeAtRatio, type RoasShade } from "./ad-efficiency";

export function marginShade(margin: number | null | undefined, target: number | null | undefined): RoasShade | null {
  if (margin == null || !Number.isFinite(margin) || !(target != null && target > 0)) return null;
  return shadeAtRatio(margin / target);
}

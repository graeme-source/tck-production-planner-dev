/**
 * Which recipes the packing screen's fridge gate checks against the
 * production fridge (Graeme, 20 Nov 2026: #139897 held for Open Fire BBQ
 * Chicken — a freezer calzone sold on a Shopify-tracked listing — while the
 * fridge count it was checked against is never taken down on despatch).
 *
 * ONE rule with despatch: the gate checks exactly the recipes a despatch
 * takes off the production fridge (despatchStockPlace === "fridge"), and
 * only fridge products. Anything else — fried chicken and buns in the
 * freezer, non-core calzones while "core menu only" is on — has no live
 * fridge count, so the gate leaves it to Shopify's own stock check (tracked
 * variants, overselling denied), exactly like F2F lines.
 */
import { despatchStockPlace } from "./despatch-stock-place";

export function fridgeGateChecks(
  r: { isCoreMenu: boolean; isFridgeProduct: boolean; category: string | null; shopifyPushOnWrap?: boolean | null },
  coreMenuOnly: boolean,
): boolean {
  if (!r.isCoreMenu && !r.isFridgeProduct) return false;
  return despatchStockPlace(r, coreMenuOnly) === "fridge";
}

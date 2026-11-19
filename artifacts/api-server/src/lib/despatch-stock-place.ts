// Where a despatched pack comes off the planner's stock (Graeme, 19 Nov 2026:
// "the system knows how much fried chicken we've got"). Calzones and other
// fridge products come off the production fridge — core menu only while the
// core-menu-only setting is on. Fried chicken lives in the production freezer
// and Shopify holds its stock, so it comes off the freezer whatever that
// setting says (it isn't core menu). Pure and unit-tested.

import { FRIED_CHICKEN_CATEGORY } from "@workspace/production-schedule";

export type DespatchStockPlace = "fridge" | "freezer" | "skip";

export function despatchStockPlace(m: { isCoreMenu: boolean; category: string | null }, coreMenuOnly: boolean): DespatchStockPlace {
  if (m.category === FRIED_CHICKEN_CATEGORY) return "freezer";
  if (coreMenuOnly && !m.isCoreMenu) return "skip";
  return "fridge";
}

/**
 * Setting fried chicken's freezer stock from Shopify's on-hand count (Graeme,
 * 19 Nov 2026: "take it from the Shopify stock"). One line per product: what
 * the planner holds, what Shopify holds, and the change that makes them match.
 * A product Shopify has no figure for is left alone.
 */
export function freezerSetFromShopify(rows: Array<{ recipeId: number; name: string; planner: number; shopify: number | null }>) {
  return rows.map(r => {
    const shopify = r.shopify == null ? null : Math.max(0, Math.round(r.shopify));
    return { ...r, shopify, change: shopify == null ? 0 : shopify - Math.max(0, Math.round(r.planner)) };
  });
}

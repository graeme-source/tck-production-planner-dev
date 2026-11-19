// Where a despatched pack comes off the planner's stock (Graeme, 19 Nov 2026:
// "the system knows how much fried chicken we've got"; buns the same, same
// day). Calzones and other fridge products come off the production fridge —
// core menu only while the core-menu-only setting is on. Products whose stock
// Shopify holds — fried chicken, and anything wrapped straight to Shopify like
// cinnamon buns (usesShopifyStock) — live in the production freezer, so they
// come off the freezer whatever that setting says. Pure and unit-tested.

import { usesShopifyStock } from "@workspace/production-schedule";

export type DespatchStockPlace = "fridge" | "freezer" | "skip";

export function despatchStockPlace(m: { isCoreMenu: boolean; category: string | null; shopifyPushOnWrap?: boolean | null }, coreMenuOnly: boolean): DespatchStockPlace {
  if (usesShopifyStock(m.category, m.shopifyPushOnWrap)) return "freezer";
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

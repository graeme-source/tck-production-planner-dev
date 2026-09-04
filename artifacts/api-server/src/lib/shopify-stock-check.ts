/**
 * Which Shopify variants Shopify ITSELF stock-checks.
 *
 * The fridge gate can only verify products it has a fridge count for —
 * calzone 2-packs and bags. Everything else TCK sells (fried chicken in the
 * freezer, dessert 5-packs, third-party sauces, F2F lines) is stocked ON
 * SHOPIFY: the variant is inventory-tracked and overselling is denied, so an
 * accepted order is itself proof the stock existed when it was placed. Those
 * lines used to show as "not stock-checked" on the packing screen when they
 * are in fact checked — just by Shopify, not by the fridge (Graeme,
 * 2026-09-04).
 *
 * Pure map-building lives here so it can be tested without the network.
 */
import type { ShopifyProduct } from "../services/shopify";

/** variantId → current Shopify inventory quantity, for variants Shopify is
 *  actually tracking (`inventory_management === "shopify"`). Untracked
 *  variants are OMITTED — absence is the signal the packing screen uses to
 *  say "nothing checked this line". */
export function trackedVariantMap(products: ShopifyProduct[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const p of products) {
    // Archived/draft products can't be ordered, so their variants have no
    // bearing on the pick list either way.
    if (p.status !== "active") continue;
    for (const v of p.variants) {
      if (v.inventory_management === "shopify") {
        map[String(v.id)] = v.inventory_quantity;
      }
    }
  }
  return map;
}

/** The marker an 8-pack bag variant carries in its variant title. The same
 *  convention wholesale-bags.ts keys on — eight_pack_variant_id was never
 *  populated in recipe_shopify_mappings, so bags are recognised by title. */
export const EIGHT_PACK_TITLE_MARKER = "8 pack bag";

/** lower-cased Shopify product title → recipeId, from mapping rows. The
 *  8-pack bag is a VARIANT of the same Shopify product as the mapped 2-pack,
 *  so the product title is the reliable join (wholesale-bags.ts does the
 *  same). Only in-scope recipes belong here — the bags pool only holds
 *  counts for core-menu / fridge-product recipes. */
export function bagRecipeByTitle(
  rows: Array<{ recipe_id: number; shopify_product_title: string | null; in_scope: boolean }>,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    if (!row.in_scope || !row.shopify_product_title) continue;
    map[row.shopify_product_title.trim().toLowerCase()] = row.recipe_id;
  }
  return map;
}

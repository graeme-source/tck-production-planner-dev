/**
 * 8-pack bags as real production-fridge stock (Graeme, 2026-10-07).
 *
 * Wrapping puts 8-pack bags in the production fridge (stock_entries /
 * fridge_stock_changes rows with pack_size 8). Until now nothing took them
 * out again, so the stored bag number was a meaningless running total. This
 * module holds the PURE rules for the bag side of the stock loop — which
 * Shopify order lines are bags, which recipe they belong to, and how a
 * despatch decrement is applied without ever going below zero. The database
 * writes live in inventory-sync.ts and go through adjustFridgeStock.
 */

/** Stock-entry / fridge_stock_batches pack size used for 8-pack bags. */
export const EIGHT_PACK_SIZE = 8;

/** An 8-pack bag is detected by its Shopify variant title — the bag is a
 *  variant ("8 Pack Bag") of the same product as the 2-pack. Shared with the
 *  wholesale-bags queue so both paths agree on what a bag line is. */
export const EIGHT_PACK_VARIANT_MATCH = "8 pack bag";

export function isEightPackLine(line: { variant_title?: string | null }): boolean {
  return (line.variant_title ?? "").toLowerCase().includes(EIGHT_PACK_VARIANT_MATCH);
}

/** Minimal line-item shape the classifier reads (REST and GraphQL lines are
 *  both translated into this). */
export interface OrderLineLike {
  variant_id: number | string | null;
  title: string | null;
  variant_title?: string | null;
  quantity: number;
  /** Quantity after refunds/order edits; 0 = removed from the order. */
  current_quantity?: number | null;
}

export interface BagLineContext {
  /** recipe_shopify_mappings.eight_pack_variant_id → recipe id. */
  eightPackVariantToRecipe: Map<string, number>;
  /** Lower-cased, trimmed Shopify product title → recipe id (the fallback
   *  the wholesale-bags queue already uses, since eight_pack_variant_id is
   *  not populated for every recipe). */
  productTitleToRecipe: Map<string, number>;
}

export interface BagLineResolution {
  /** Bags per recipe in this order. */
  bagsByRecipe: Map<number, number>;
  /** Bag lines that could not be resolved to a recipe (product titles). */
  unmapped: string[];
}

/** Bags a line still asks for: refunded/removed lines count as 0. */
export function lineBagQuantity(line: OrderLineLike): number {
  const q = line.current_quantity ?? line.quantity;
  return Number.isFinite(q) && q > 0 ? Math.trunc(q) : 0;
}

/**
 * Is this line an 8-pack bag? True when its variant id is a mapped
 * eight_pack_variant_id OR its variant title says "8 pack bag".
 */
export function isBagLine(line: OrderLineLike, ctx: BagLineContext): boolean {
  if (line.variant_id != null && ctx.eightPackVariantToRecipe.has(String(line.variant_id))) return true;
  return isEightPackLine(line);
}

/**
 * Sum the bags in an order per recipe. Only bag lines are considered —
 * the caller routes the remaining lines through the 2-pack path. The
 * mapped variant id wins over the product-title fallback.
 */
export function resolveBagLines(lines: OrderLineLike[], ctx: BagLineContext): BagLineResolution {
  const bagsByRecipe = new Map<number, number>();
  const unmapped: string[] = [];
  for (const line of lines) {
    if (!isBagLine(line, ctx)) continue;
    const qty = lineBagQuantity(line);
    if (qty <= 0) continue;
    const byVariant = line.variant_id != null
      ? ctx.eightPackVariantToRecipe.get(String(line.variant_id))
      : undefined;
    const recipeId = byVariant ?? ctx.productTitleToRecipe.get((line.title ?? "").trim().toLowerCase());
    if (recipeId == null) {
      unmapped.push(line.title ?? "(untitled)");
      continue;
    }
    bagsByRecipe.set(recipeId, (bagsByRecipe.get(recipeId) ?? 0) + qty);
  }
  return { bagsByRecipe, unmapped };
}

export interface BagDecrementPlan {
  /** Signed delta to apply (≤ 0). Never takes the count below zero. */
  delta: number;
  /** Bags left after the decrement. */
  resultingQty: number;
  /** Bags despatched that the stock record didn't have — a sign the
   *  counted number was wrong. 0 when the count covered the despatch. */
  shortfall: number;
}

/** Never-negative rule: remove at most what the record holds, and report
 *  the rest as a shortfall so it can be flagged. */
export function planBagDecrement(onHand: number, bagsOut: number): BagDecrementPlan {
  const have = Math.max(0, Math.trunc(onHand) || 0);
  const out = Math.max(0, Math.trunc(bagsOut) || 0);
  const take = Math.min(have, out);
  return { delta: take === 0 ? 0 : -take, resultingQty: have - take, shortfall: out - take };
}

/**
 * Pure counting rules for "packs still to leave the fridge today".
 * Kept free of the database so they can be unit-tested; the loader in
 * remaining-fulfilment.ts fetches the orders, mappings and tracking rows.
 */

export interface RemainingOrderLine {
  variant_id?: number | string | null;
  quantity?: number | null;
}

export interface RemainingOrder {
  id: number;
  line_items?: RemainingOrderLine[] | null;
}

export interface VariantRecipe {
  recipeId: number;
  isCoreMenu: boolean;
}

export interface RemainingPacksCount {
  byRecipe: Record<number, number>;
  totalLineItems: number;
  mappedLineItems: number;
  skippedNonCoreLineItems: number;
  unmappedVariantIds: string[];
  /** Orders Shopify still lists as unfulfilled whose packs have ALREADY been
   *  taken off the fridge (scanned out, then the Shopify fulfil failed or
   *  hadn't shown up in Shopify's order search yet). */
  alreadyOffStockOrderCount: number;
}

/**
 * Sums unfulfilled order lines per recipe.
 *
 * @param alreadyOffStock  Order ids the fulfilment scan (or poller) has
 *   already decremented from fridge stock — the shopify_fulfilment_tracking
 *   table. Those packs are out of the live count, so subtracting them again
 *   would count the order twice. This is what keeps the figure exact while
 *   the pack is running, not just before or after it.
 */
export function countRemainingPacks(
  orders: RemainingOrder[],
  variantToRecipe: Map<string, VariantRecipe>,
  opts: { coreMenuOnly?: boolean; limitToRecipeIds?: number[] } = {},
  alreadyOffStock: Set<number> = new Set(),
): RemainingPacksCount {
  const limit = opts.limitToRecipeIds ? new Set(opts.limitToRecipeIds) : null;
  const out: RemainingPacksCount = {
    byRecipe: {},
    totalLineItems: 0,
    mappedLineItems: 0,
    skippedNonCoreLineItems: 0,
    unmappedVariantIds: [],
    alreadyOffStockOrderCount: 0,
  };
  const unmapped = new Set<string>();
  for (const order of orders) {
    if (alreadyOffStock.has(Number(order.id))) {
      out.alreadyOffStockOrderCount += 1;
      continue;
    }
    for (const line of order.line_items ?? []) {
      if (!line.variant_id) continue;
      out.totalLineItems += 1;
      const mapping = variantToRecipe.get(String(line.variant_id));
      if (!mapping) {
        unmapped.add(String(line.variant_id));
        continue;
      }
      if (limit && !limit.has(mapping.recipeId)) continue;
      if (opts.coreMenuOnly && !mapping.isCoreMenu) {
        out.skippedNonCoreLineItems += 1;
        continue;
      }
      out.mappedLineItems += 1;
      out.byRecipe[mapping.recipeId] = (out.byRecipe[mapping.recipeId] ?? 0) + (line.quantity || 0);
    }
  }
  out.unmappedVariantIds = [...unmapped];
  return out;
}

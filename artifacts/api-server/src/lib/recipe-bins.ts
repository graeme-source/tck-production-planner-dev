/**
 * Which bins on the fridge map a RECIPE lives in.
 *
 * Bins are keyed by Shopify variant (`variant_locations`, migration 0112)
 * because a TCK SKU is a shelf label shared by many products. A recipe is
 * not a variant though — it maps to several (the 2-pack, the 8-pack bag,
 * the wonky listing), and those can sit in different bins.
 *
 * So anything that needs to walk RECIPES in picking order — the packing
 * station's first/last pack batch-number checks — needs the full set of
 * bins a recipe's packs live in. This resolves that set. Choosing WHICH of
 * them decides the recipe's place in the walk is `earliestBin` in the
 * frontend's lib/pick-order, because that depends on the live zone order an
 * admin can drag around on Bin Locations; keeping the choice there means
 * there is exactly one copy of the walk and it is always the current one.
 */

/** A bin as the picking screen knows it. */
export interface RecipeBin {
  zone: string;
  locationLabel: string;
  door: number | null;
  shelf: string | null;
}

/** One row of recipe_shopify_mappings, trimmed to what matters here. */
export interface RecipeVariantMapping {
  recipeId: number;
  /** Every Shopify variant this row points at: the main pack, the wonky
   *  listing and the 8-pack bag. Nulls are normal and ignored. */
  variantIds: ReadonlyArray<string | null | undefined>;
  /** Cached Shopify SKU, used only as a fallback for a variant with no bin
   *  of its own — mirroring the picking list's own fallback. */
  sku?: string | null;
}

/**
 * Build recipeId → the distinct bins its packs live in.
 *
 * A variant's bin wins; a variant with no bin of its own falls back to its
 * SKU's legacy location, exactly as the picking list does (a SKU-keyed bin
 * can only describe one of the products sharing that label, so it can
 * preserve the old behaviour but never improve on it).
 *
 * Duplicate bins are collapsed — three variants behind the same door is one
 * stop on the walk. Recipes whose packs have no bin anywhere get an empty
 * array rather than being dropped: they still need checking, they just sort
 * to the end.
 */
export function resolveRecipeBins(
  mappings: readonly RecipeVariantMapping[],
  binByVariantId: ReadonlyMap<string, RecipeBin>,
  binBySku: ReadonlyMap<string, RecipeBin>,
): Map<number, RecipeBin[]> {
  const byRecipe = new Map<number, RecipeBin[]>();
  const seen = new Map<number, Set<string>>();

  for (const mapping of mappings) {
    if (mapping.recipeId == null) continue;
    const bins = byRecipe.get(mapping.recipeId) ?? [];
    const keys = seen.get(mapping.recipeId) ?? new Set<string>();

    for (const variantId of mapping.variantIds) {
      if (!variantId) continue;
      const bin =
        binByVariantId.get(variantId)
        ?? (mapping.sku ? binBySku.get(mapping.sku) : undefined);
      if (!bin) continue;
      const key = `${bin.zone}|${bin.door ?? ""}|${bin.shelf ?? ""}|${bin.locationLabel}`;
      if (keys.has(key)) continue;
      keys.add(key);
      bins.push(bin);
    }

    byRecipe.set(mapping.recipeId, bins);
    seen.set(mapping.recipeId, keys);
  }

  return byRecipe;
}

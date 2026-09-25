/**
 * Packs still to leave the fridge today.
 *
 * The Factory Number everyone plans from is a PREDICTED end-of-day figure,
 * not a live count: stock as it stands, plus what wrapping still has to add,
 * minus the orders that haven't gone out yet. Reading live stock alone counts
 * packs that are already spoken for, and the plan comes out short.
 *
 * Extracted 2026-08-21 because the macaroni cheese calculation was doing
 * exactly that — reading fridge stock as if the day's dispatches had already
 * happened. Rather than write the deduction a second time and let the two
 * drift, both paths now compute it here.
 */

import { db, shopifyFulfilmentTrackingTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { getUnfulfilledOrdersByTag } from "../services/shopify";
import { countRemainingPacks } from "./remaining-fulfilment-rules";

export interface RemainingFulfilmentDiagnostics {
  tagQueried: string;
  unfulfilledOrderCount: number;
  totalLineItems: number;
  mappedLineItems: number;
  skippedNonCoreLineItems: number;
  unmappedVariantIds: string[];
  /** Unfulfilled-on-Shopify orders already scanned off the fridge (skipped). */
  alreadyOffStockOrderCount: number;
  error: string | null;
}

export interface RemainingFulfilmentResult {
  /** recipeId → packs still to be dispatched today. */
  byRecipe: Record<number, number>;
  /** Why a number might look wrong — a Shopify tag lag, a missing variant
   *  mapping, or the core-menu filter quietly excluding lines. */
  diagnostics: RemainingFulfilmentDiagnostics;
}

/**
 * @param deliveryDate  The delivery-date tag to read unfulfilled orders for.
 * @param opts.coreMenuOnly  Skip lines whose recipe isn't core menu, matching
 *   the calzone path's flag. Leave false to count every mapped line.
 * @param opts.limitToRecipeIds  Only accumulate these recipes. The mac cheese
 *   path passes its own recipe ids so an unrelated calzone line can't leak in.
 *
 * Never throws: an outage here must degrade to "deduct nothing" (which shows
 * live stock, the old behaviour) rather than break planning altogether. The
 * reason lands in `diagnostics.error`.
 */
export async function remainingFulfilmentPacks(
  deliveryDate: string,
  opts: { coreMenuOnly?: boolean; limitToRecipeIds?: number[] } = {},
): Promise<RemainingFulfilmentResult> {
  const byRecipe: Record<number, number> = {};
  const diagnostics: RemainingFulfilmentDiagnostics = {
    tagQueried: deliveryDate,
    unfulfilledOrderCount: 0,
    totalLineItems: 0,
    mappedLineItems: 0,
    skippedNonCoreLineItems: 0,
    unmappedVariantIds: [],
    alreadyOffStockOrderCount: 0,
    error: null,
  };

  try {
    const unfulfilled = await getUnfulfilledOrdersByTag(deliveryDate);
    diagnostics.unfulfilledOrderCount = unfulfilled.length;
    if (unfulfilled.length === 0) return { byRecipe, diagnostics };

    const mappingRows = await db.execute<{
      recipe_id: number;
      shopify_variant_id: string;
      wonky_variant_id: string | null;
      is_core_menu: boolean;
    }>(sql`
      SELECT m.recipe_id, m.shopify_variant_id, m.wonky_variant_id, r.is_core_menu
      FROM recipe_shopify_mappings m
      INNER JOIN recipes r ON r.id = m.recipe_id
    `);

    // db.execute() returns { rows, rowCount } from node-postgres — iterating
    // the wrapper directly throws "rows is not iterable", which used to fall
    // silently into the catch below and leave the deduction empty. That
    // overstated the Factory Number by exactly today's unfulfilled orders,
    // which is the failure this whole function exists to prevent.
    const variantToRecipe = new Map<string, { recipeId: number; isCoreMenu: boolean }>();
    for (const m of mappingRows.rows ?? mappingRows) {
      const entry = { recipeId: m.recipe_id, isCoreMenu: m.is_core_menu };
      if (m.shopify_variant_id) variantToRecipe.set(String(m.shopify_variant_id), entry);
      // Wonky packs come off the same stock, so they count against it too.
      if (m.wonky_variant_id) variantToRecipe.set(String(m.wonky_variant_id), entry);
    }

    // Orders the fulfilment scan (or poller) has already taken off the
    // fridge. Shopify can still list one as unfulfilled for a short while
    // after the scan — its order search lags — or indefinitely if the
    // Shopify fulfil call failed after the decrement. Either way its packs
    // are out of the live count and must not be subtracted again.
    const orderIds = unfulfilled.map(o => Number(o.id)).filter(n => Number.isFinite(n));
    const trackedRows = orderIds.length > 0
      ? await db
        .select({ id: shopifyFulfilmentTrackingTable.shopifyOrderId })
        .from(shopifyFulfilmentTrackingTable)
        .where(inArray(shopifyFulfilmentTrackingTable.shopifyOrderId, orderIds))
      : [];
    const alreadyOffStock = new Set(trackedRows.map(r => Number(r.id)));

    const counted = countRemainingPacks(unfulfilled, variantToRecipe, opts, alreadyOffStock);
    Object.assign(byRecipe, counted.byRecipe);
    diagnostics.totalLineItems = counted.totalLineItems;
    diagnostics.mappedLineItems = counted.mappedLineItems;
    diagnostics.skippedNonCoreLineItems = counted.skippedNonCoreLineItems;
    diagnostics.unmappedVariantIds = counted.unmappedVariantIds;
    diagnostics.alreadyOffStockOrderCount = counted.alreadyOffStockOrderCount;
  } catch (err) {
    diagnostics.error = err instanceof Error ? err.message : String(err);
    console.warn(`[remaining-fulfilment] ${deliveryDate}: falling back to live stock —`, diagnostics.error);
  }

  return { byRecipe, diagnostics };
}

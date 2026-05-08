/**
 * Shared helpers for the factory-number accounting loop.
 *
 * The loop in a nutshell:
 *   wrapping station (+) → production fridge ← (−) Shopify fulfilment
 *
 * Wrapping adds via `syncRecipeFridgeStock(+qty)` on the wrapping route.
 * Fulfilment removes via `decrementFridgeForShopifyOrder()` below, which
 * is called from two places: the immediate "Confirm & Complete" path in
 * fulfilment.ts, and a 5-minute safety-net poller that catches orders
 * fulfilled outside the TCK UI. Both paths dedupe via the
 * `shopify_fulfilment_tracking` table.
 *
 * A feature flag limits the loop to core-menu recipes while we validate
 * it end-to-end. Flip it off once all recipes have correct Shopify
 * variant mappings.
 */
import { db, appSettingsTable, fridgeStockBatchesTable } from "@workspace/db";
import { eq, and, gt, asc, sql } from "drizzle-orm";
import { syncRecipeFridgeStock } from "../routes/production-plans";
import type { ShopifyLineItem } from "../services/shopify";

/**
 * Runtime feature flag: limit the factory-number loop to core-menu
 * recipes only. Stored in the app_settings table under the key
 * `factory_number_core_menu_only` with value "true" or "false".
 *
 * When enabled:
 *   - Non-core variants are silently skipped during the fulfilment
 *     decrement (they're not even logged as unmapped).
 *   - Non-core recipes get `predictedFridgeStock = liveFridgeStock` in
 *     the /calculate endpoint (no wrapping-in, no fulfilment-out).
 *   - The reset endpoint zeroes only core-menu recipes.
 *   - The frontend Create Plan column header shows a "Core menu only"
 *     badge.
 *
 * Default is `true` when the setting row doesn't exist. The frontend
 * Settings page has an admin-only toggle to flip it at runtime without
 * any restart — the value is cached in memory for 30 seconds and
 * re-read on cache miss, so flipping takes effect within a few seconds
 * on the backend and on the next page load on the frontend.
 */
export const FACTORY_NUMBER_CORE_MENU_ONLY_KEY = "factory_number_core_menu_only";
export const FACTORY_NUMBER_CORE_MENU_ONLY_DEFAULT = true;

/**
 * Kill switch for the wrapping-complete → Shopify inventory upload. When
 * disabled, wrapping-complete still freezes wonky packs and updates
 * production_freezer stock locally, it just skips the Shopify push so
 * the online storefront is untouched.
 *
 * Defaults to `false` — the operator has to opt in from the Settings
 * page once they're satisfied the inventory sync is behaving correctly.
 */
export const SHOPIFY_FREEZER_SYNC_ENABLED_KEY = "shopify_freezer_sync_enabled";
export const SHOPIFY_FREEZER_SYNC_ENABLED_DEFAULT = false;

let cachedFlag: { value: boolean; loadedAt: number } | null = null;
let cachedShopifySyncFlag: { value: boolean; loadedAt: number } | null = null;
const FLAG_CACHE_TTL_MS = 30_000;

export async function getFactoryNumberCoreMenuOnly(): Promise<boolean> {
  if (cachedFlag && Date.now() - cachedFlag.loadedAt < FLAG_CACHE_TTL_MS) {
    return cachedFlag.value;
  }
  try {
    const [row] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, FACTORY_NUMBER_CORE_MENU_ONLY_KEY));
    const value = row ? row.value === "true" : FACTORY_NUMBER_CORE_MENU_ONLY_DEFAULT;
    cachedFlag = { value, loadedAt: Date.now() };
    return value;
  } catch (err) {
    console.error("[inventory-sync] failed to read factory-number flag, using default:", err);
    return FACTORY_NUMBER_CORE_MENU_ONLY_DEFAULT;
  }
}

export async function getShopifyFreezerSyncEnabled(): Promise<boolean> {
  if (cachedShopifySyncFlag && Date.now() - cachedShopifySyncFlag.loadedAt < FLAG_CACHE_TTL_MS) {
    return cachedShopifySyncFlag.value;
  }
  try {
    const [row] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, SHOPIFY_FREEZER_SYNC_ENABLED_KEY));
    const value = row ? row.value === "true" : SHOPIFY_FREEZER_SYNC_ENABLED_DEFAULT;
    cachedShopifySyncFlag = { value, loadedAt: Date.now() };
    return value;
  } catch (err) {
    console.error("[inventory-sync] failed to read shopify-freezer-sync flag, using default:", err);
    return SHOPIFY_FREEZER_SYNC_ENABLED_DEFAULT;
  }
}

/** Force-clear the cached flag so the next read hits the DB immediately.
 *  Called by the /factory-number-config endpoint after a PUT. */
export function invalidateFactoryNumberFlagCache() {
  cachedFlag = null;
}

/** Called by the /shopify-freezer-sync-config endpoint after a PUT. */
export function invalidateShopifyFreezerSyncFlagCache() {
  cachedShopifySyncFlag = null;
}

interface VariantMapping {
  recipeId: number;
  isCoreMenu: boolean;
}

let mappingCache: Map<string, VariantMapping> | null = null;
let mappingCacheLoadedAt = 0;
const MAPPING_CACHE_TTL_MS = 60_000;

/**
 * Loads all recipe_shopify_mappings rows (main + wonky variants) joined
 * with recipes.is_core_menu. Returns a single map keyed by variant id
 * (string, matching Shopify's variant id type in line items), where
 * each value points at the recipe id and whether it's a core recipe.
 *
 * Cached for 60 seconds so the poller doesn't hammer the DB.
 * recipe_shopify_mappings has no drizzle schema entry — it's created in
 * src/index.ts startup migration and everything uses raw SQL against it.
 */
async function loadVariantMap(): Promise<Map<string, VariantMapping>> {
  if (mappingCache && Date.now() - mappingCacheLoadedAt < MAPPING_CACHE_TTL_MS) {
    return mappingCache;
  }
  const result = await db.execute<{
    recipe_id: number;
    shopify_variant_id: string;
    wonky_variant_id: string | null;
    is_core_menu: boolean;
  }>(sql`
    SELECT m.recipe_id, m.shopify_variant_id, m.wonky_variant_id, r.is_core_menu
    FROM recipe_shopify_mappings m
    INNER JOIN recipes r ON r.id = m.recipe_id
  `);

  // node-postgres returns { rows, rowCount } — not a directly iterable array.
  // Bug: iterating the result object threw "rows is not iterable" the first
  // time an operator clicked Process Fulfilled Today on the live server.
  const map = new Map<string, VariantMapping>();
  for (const row of result.rows) {
    const entry: VariantMapping = { recipeId: row.recipe_id, isCoreMenu: row.is_core_menu };
    if (row.shopify_variant_id) map.set(String(row.shopify_variant_id), entry);
    if (row.wonky_variant_id) map.set(String(row.wonky_variant_id), entry);
  }
  mappingCache = map;
  mappingCacheLoadedAt = Date.now();
  return map;
}

/** Force-invalidate the cache, e.g. after the user saves a new mapping via the recipe dialog. */
export function invalidateVariantMapCache() {
  mappingCache = null;
}

export interface DecrementResult {
  decremented: Array<{ recipeId: number; packs: number }>;
  unmapped: string[]; // variant IDs we couldn't resolve to a recipe (only logged in non-core-only mode)
  skippedNonCore: number; // count of line items skipped because the recipe isn't core menu
}

/**
 * Decrement production_fridge stock for every line item in a Shopify
 * order. Looks up recipes via `recipe_shopify_mappings` (main + wonky
 * variants). Honors FACTORY_NUMBER_CORE_MENU_ONLY.
 *
 * Never throws on a mapping miss — the caller should log unmapped
 * variants so the operator can populate them later, but fulfilment
 * must keep working.
 */
export async function decrementFridgeForShopifyOrder(
  _orderId: number,
  lineItems: ShopifyLineItem[],
): Promise<DecrementResult> {
  const result: DecrementResult = { decremented: [], unmapped: [], skippedNonCore: 0 };
  const [variantMap, coreMenuOnly] = await Promise.all([
    loadVariantMap(),
    getFactoryNumberCoreMenuOnly(),
  ]);

  // Aggregate per recipe so orders with multiple variants of the same
  // recipe only do one update.
  const perRecipe = new Map<number, number>();

  for (const line of lineItems) {
    if (!line.variant_id) continue;
    const variantKey = String(line.variant_id);
    const mapping = variantMap.get(variantKey);
    if (!mapping) {
      // Only track unmapped variants when the flag is off — with the
      // flag on, non-core variants would flood this log.
      if (!coreMenuOnly) result.unmapped.push(variantKey);
      continue;
    }
    if (coreMenuOnly && !mapping.isCoreMenu) {
      result.skippedNonCore += 1;
      continue;
    }
    perRecipe.set(mapping.recipeId, (perRecipe.get(mapping.recipeId) ?? 0) + (line.quantity || 0));
  }

  for (const [recipeId, packs] of perRecipe) {
    if (packs <= 0) continue;
    try {
      // Decrement aggregate stock entry
      await syncRecipeFridgeStock(recipeId, -packs);

      // FIFO batch deduction — oldest use-by date first
      let remaining = packs;
      const batches = await db
        .select()
        .from(fridgeStockBatchesTable)
        .where(and(
          eq(fridgeStockBatchesTable.recipeId, recipeId),
          gt(fridgeStockBatchesTable.quantity, 0),
        ))
        .orderBy(asc(fridgeStockBatchesTable.useByDate));

      for (const batch of batches) {
        if (remaining <= 0) break;
        const deduct = Math.min(remaining, batch.quantity);
        if (deduct >= batch.quantity) {
          await db.delete(fridgeStockBatchesTable).where(eq(fridgeStockBatchesTable.id, batch.id));
        } else {
          await db.update(fridgeStockBatchesTable)
            .set({ quantity: batch.quantity - deduct })
            .where(eq(fridgeStockBatchesTable.id, batch.id));
        }
        remaining -= deduct;
      }

      result.decremented.push({ recipeId, packs });
    } catch (err) {
      console.error(`[inventory-sync] syncRecipeFridgeStock failed for recipe ${recipeId}:`, err);
    }
  }

  return result;
}

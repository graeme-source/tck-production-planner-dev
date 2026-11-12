/**
 * Loads the date-locked product list (rules: date-locked-products-rules.ts):
 * the Shopify variants of every recipe made as test production in the last
 * two weeks or coming up (queued_production), and of every draft recipe,
 * plus the title patterns (8-pack bags, test boxes). Cached for a minute.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { addDaysToDateString, londonDateString } from "./london-time";
import { LOCKED_TITLE_PATTERNS, TEST_PRODUCTION_LOOKBACK_DAYS, type DateLockedProducts } from "./date-locked-products-rules";

let cache: { at: number; value: DateLockedProducts } | null = null;
const TTL_MS = 60_000;

export async function loadDateLockedProducts(): Promise<DateLockedProducts> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const from = addDaysToDateString(londonDateString(), -TEST_PRODUCTION_LOOKBACK_DAYS);
  // A product marked "safe to move" (recipes.date_change_safe — always in
  // stock, e.g. Garlic Mayo) never locks, whatever else applies.
  const rows = await db.execute<{ shopify_variant_id: string | null; wonky_variant_id: string | null; recipe_id: number; name: string }>(sql`
    SELECT m.shopify_variant_id, m.wonky_variant_id, r.id AS recipe_id, r.name
    FROM recipe_shopify_mappings m
    JOIN recipes r ON r.id = m.recipe_id
    WHERE NOT r.date_change_safe
      AND (r.is_draft = true
       OR r.id IN (SELECT recipe_id FROM queued_production WHERE production_date >= ${from} AND recipe_id IS NOT NULL))
  `);
  const ids = new Set<string>();
  const products: Record<string, { recipeId: number; name: string }> = {};
  for (const r of rows.rows) {
    for (const v of [r.shopify_variant_id, r.wonky_variant_id]) {
      if (!v) continue;
      ids.add(String(v));
      products[String(v)] = { recipeId: Number(r.recipe_id), name: r.name };
    }
  }
  const value = { variantIds: [...ids], titlePatterns: [...LOCKED_TITLE_PATTERNS], products };
  cache = { at: Date.now(), value };
  return value;
}

/** Forget the cached list — after a product is marked safe to move or not. */
export function clearDateLockedProductsCache(): void {
  cache = null;
}

/** The products marked safe to move, for the Friday check page. */
export async function loadSafeToMoveProducts(): Promise<Array<{ recipeId: number; name: string }>> {
  const rows = await db.execute<{ id: number; name: string }>(sql`SELECT id, name FROM recipes WHERE date_change_safe ORDER BY name`);
  return rows.rows.map(r => ({ recipeId: Number(r.id), name: r.name }));
}

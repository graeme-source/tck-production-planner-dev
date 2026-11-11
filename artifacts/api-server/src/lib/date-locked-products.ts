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
  const rows = await db.execute<{ shopify_variant_id: string | null; wonky_variant_id: string | null }>(sql`
    SELECT m.shopify_variant_id, m.wonky_variant_id
    FROM recipe_shopify_mappings m
    JOIN recipes r ON r.id = m.recipe_id
    WHERE r.is_draft = true
       OR r.id IN (SELECT recipe_id FROM queued_production WHERE production_date >= ${from} AND recipe_id IS NOT NULL)
  `);
  const ids = new Set<string>();
  for (const r of rows.rows) {
    if (r.shopify_variant_id) ids.add(String(r.shopify_variant_id));
    if (r.wonky_variant_id) ids.add(String(r.wonky_variant_id));
  }
  const value = { variantIds: [...ids], titlePatterns: [...LOCKED_TITLE_PATTERNS] };
  cache = { at: Date.now(), value };
  return value;
}

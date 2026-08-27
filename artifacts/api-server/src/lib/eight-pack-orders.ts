/**
 * Reading 8-pack bag lines off Shopify orders.
 *
 * Shared by the processing queue (routes/wholesale-bags.ts) and the bag-cover
 * check (routes/bag-cover.ts). They have to agree on what counts as a bag and
 * which recipe it belongs to — a check that disagrees with the thing it is
 * checking is worse than no check.
 *
 * The two rules, unchanged from the original processing code:
 *  - "Eight-pack bag" is a variant whose title contains "8 pack bag".
 *  - A line maps to a recipe by PRODUCT title, because the 8-pack is a variant
 *    of the same Shopify product as the 2-pack and eight_pack_variant_id is
 *    not populated. Unmappable lines are reported, never guessed.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const EIGHT_PACK_MATCH = "8 pack bag";
export const PRODUCTION_TAG = "production";
export const DATE_TAG_RE = /^\d{4}-\d{2}-\d{2}$/;

export function is8PackLine(li: { variant_title: string | null }): boolean {
  return (li.variant_title ?? "").toLowerCase().includes(EIGHT_PACK_MATCH);
}

export function orderTags(tags: string): string[] {
  return tags.split(",").map(t => t.trim()).filter(Boolean);
}

export function hasProductionTag(tags: string): boolean {
  return orderTags(tags).map(t => t.toLowerCase()).includes(PRODUCTION_TAG);
}

/** The first YYYY-MM-DD tag on an order — the delivery date it's routed to. */
export function firstDateTag(tags: string): string | null {
  for (const t of orderTags(tags)) if (DATE_TAG_RE.test(t)) return t;
  return null;
}

export interface RecipeRef { recipeId: number; recipeName: string }

/** Normalised product title → recipe. */
export async function loadTitleToRecipe(): Promise<Map<string, RecipeRef>> {
  const rows = await db.execute<{ title: string; recipe_id: number; name: string }>(sql`
    SELECT DISTINCT m.shopify_product_title AS title, m.recipe_id, r.name
    FROM recipe_shopify_mappings m
    JOIN recipes r ON r.id = m.recipe_id
    WHERE m.shopify_product_title IS NOT NULL
  `);
  const map = new Map<string, RecipeRef>();
  for (const row of rows.rows) {
    const key = (row.title ?? "").trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, { recipeId: row.recipe_id, recipeName: row.name });
  }
  return map;
}

/** Resolve one order line to a recipe, or null when nothing maps. */
export function recipeForLine(
  li: { title: string | null },
  titleToRecipe: Map<string, RecipeRef>,
): RecipeRef | null {
  return titleToRecipe.get((li.title ?? "").trim().toLowerCase()) ?? null;
}

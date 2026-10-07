/**
 * Which recipe an 8-pack bag line belongs to (DB loader).
 *
 * eight_pack_variant_id is mapped for some recipes only, so a bag line is
 * also resolved by its Shopify product title — the bag is a variant of the
 * same product as the 2-pack. ONE loader shared by the wholesale-bags queue
 * (bags onto the plan) and the despatch decrement (bags out of the fridge),
 * so both always agree on which recipe a bag is.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export interface TitleRecipe { recipeId: number; recipeName: string }

/** Lower-cased, trimmed Shopify product title → recipe (first mapping wins). */
export async function loadProductTitleToRecipe(): Promise<Map<string, TitleRecipe>> {
  const rows = await db.execute<{ title: string; recipe_id: number; name: string }>(sql`
    SELECT DISTINCT m.shopify_product_title AS title, m.recipe_id, r.name
    FROM recipe_shopify_mappings m
    JOIN recipes r ON r.id = m.recipe_id
    WHERE m.shopify_product_title IS NOT NULL
  `);
  const map = new Map<string, TitleRecipe>();
  for (const row of rows.rows) {
    const key = (row.title ?? "").trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, { recipeId: row.recipe_id, recipeName: row.name });
  }
  return map;
}

/** recipe_shopify_mappings.eight_pack_variant_id → recipe id. */
export async function loadEightPackVariantToRecipe(): Promise<Map<string, number>> {
  const rows = await db.execute<{ recipe_id: number; eight_pack_variant_id: string }>(sql`
    SELECT recipe_id, eight_pack_variant_id
    FROM recipe_shopify_mappings
    WHERE eight_pack_variant_id IS NOT NULL AND eight_pack_variant_id <> ''
  `);
  const map = new Map<string, number>();
  for (const row of rows.rows) map.set(String(row.eight_pack_variant_id), row.recipe_id);
  return map;
}

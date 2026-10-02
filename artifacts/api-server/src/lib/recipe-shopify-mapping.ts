/**
 * Linking a Shopify variant to a recipe (recipe_shopify_mappings) — the one
 * place the row is written, so the recipe page and the test-box product
 * creator can't drift. The variant id is the identity (an SKU is only a shelf
 * label, shared between products); a variant belongs to at most one recipe
 * (unique index on shopify_variant_id).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

type Conn = Pick<typeof db, "execute">;

export interface VariantLink {
  recipeId: number;
  shopifyVariantId: string;
  shopifyProductTitle?: string | null;
  shopifyVariantTitle?: string | null;
  wonkyVariantId?: string | null;
  wonkyProductTitle?: string | null;
  wonkyVariantTitle?: string | null;
  shopifySku?: string | null;
}

/**
 * "reassign": the variant moves to this recipe if it was linked elsewhere
 *   (the recipe page's Shopify mapping, as it always has).
 * "keep": a variant already linked to ANOTHER recipe is left alone and
 *   reported — the test-box flow never steals a live product's link.
 */
export async function linkVariantToRecipe(
  conn: Conn, link: VariantLink, onConflict: "reassign" | "keep",
): Promise<{ linked: boolean; otherRecipeId: number | null }> {
  const values = sql`(${link.recipeId}, ${link.shopifyVariantId}, ${link.shopifyProductTitle ?? null}, ${link.shopifyVariantTitle ?? null},
    ${link.wonkyVariantId ?? null}, ${link.wonkyProductTitle ?? null}, ${link.wonkyVariantTitle ?? null}, ${link.shopifySku ?? null})`;
  const cols = sql`(recipe_id, shopify_variant_id, shopify_product_title, shopify_variant_title, wonky_variant_id, wonky_product_title, wonky_variant_title, shopify_sku)`;
  if (onConflict === "reassign") {
    await conn.execute(sql`
      INSERT INTO recipe_shopify_mappings ${cols} VALUES ${values}
      ON CONFLICT (shopify_variant_id) DO UPDATE SET
        recipe_id             = EXCLUDED.recipe_id,
        shopify_product_title = EXCLUDED.shopify_product_title,
        shopify_variant_title = EXCLUDED.shopify_variant_title,
        wonky_variant_id      = EXCLUDED.wonky_variant_id,
        wonky_product_title   = EXCLUDED.wonky_product_title,
        wonky_variant_title   = EXCLUDED.wonky_variant_title,
        shopify_sku           = COALESCE(EXCLUDED.shopify_sku, recipe_shopify_mappings.shopify_sku)
    `);
    return { linked: true, otherRecipeId: null };
  }
  const ins = await conn.execute<{ id: number }>(sql`
    INSERT INTO recipe_shopify_mappings ${cols} VALUES ${values}
    ON CONFLICT (shopify_variant_id) DO NOTHING RETURNING id
  `);
  if (ins.rows.length) return { linked: true, otherRecipeId: null };
  const cur = await conn.execute<{ recipe_id: number }>(sql`SELECT recipe_id FROM recipe_shopify_mappings WHERE shopify_variant_id = ${link.shopifyVariantId}`);
  const owner = cur.rows[0] ? Number(cur.rows[0].recipe_id) : null;
  return owner === link.recipeId ? { linked: true, otherRecipeId: null } : { linked: false, otherRecipeId: owner };
}

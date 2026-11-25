/**
 * Writing a recipe's F2F (frozen) Shopify product link (recipes.f2f_variant_id,
 * migration 0397) — the one place it's written, for the Recipes page's F2F
 * links (routes/recipe-f2f.ts) and the Order Analysis pop-up
 * (services/variant-costs.ts). One F2F product per recipe; a variant is the
 * F2F of at most one recipe.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { forgetRecipeMappings } from "./pnl-calculator";

export type F2fLinkResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

export async function setRecipeF2fLink(
  recipeId: number,
  link: { variantId: string; productTitle?: string | null; variantTitle?: string | null } | null,
): Promise<F2fLinkResult> {
  if (link) {
    const other = await db.execute<{ id: number; name: string }>(sql`SELECT id, name FROM recipes WHERE f2f_variant_id = ${link.variantId} AND id <> ${recipeId}`);
    if (other.rows[0]) return { ok: false, status: 409, error: `That F2F product is already linked to ${other.rows[0].name.trim()}.` };
  }
  const r = await db.execute(sql`
    UPDATE recipes SET f2f_variant_id = ${link?.variantId ?? null}, f2f_product_title = ${link ? link.productTitle ?? null : null},
           f2f_variant_title = ${link ? link.variantTitle ?? null : null}
     WHERE id = ${recipeId}`);
  if (!r.rowCount) return { ok: false, status: 404, error: "No such recipe" };
  forgetRecipeMappings();
  return { ok: true };
}

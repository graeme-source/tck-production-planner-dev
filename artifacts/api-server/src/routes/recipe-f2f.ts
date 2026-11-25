/**
 * F2F (frozen) product links (Graeme, 25 Nov 2026): "I basically need to be
 * able to set an F2F mapped product against all core recipes because they
 * all carry exactly the same cost as the original recipe … We need to flag
 * if we don't have an F2F map product."
 *
 *   GET /api/recipe-f2f              core recipes with their F2F link, a
 *                                    suggested match, and the F2F products
 *                                    seen on orders (the list to pick from)
 *   PUT /api/recipe-f2f/:recipeId    { variantId, productTitle, variantTitle } | { variantId: null }
 *
 * Managers and admins. The link makes Order Analysis and the P&L cost F2F
 * sales as the recipe (lib/pnl-calculator.ts), and is where the fridge →
 * freezer move will add stock. Matching rule: lib/recipe-f2f.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { suggestF2f, type F2fProduct } from "../lib/recipe-f2f";
import { forgetRecipeMappings } from "../lib/pnl-calculator";

const router: IRouter = Router();
router.use(requireManagerOrAdmin);

/** F2F products sold in the last year, newest title per variant. */
async function f2fProducts(): Promise<F2fProduct[]> {
  const r = await db.execute<{ vid: string; title: string; vtitle: string | null }>(sql`
    SELECT DISTINCT ON (li->>'variant_id') li->>'variant_id' AS vid, li->>'title' AS title, li->>'variant_title' AS vtitle
      FROM shopify_orders_cache, jsonb_array_elements(COALESCE(payload->'line_items', '[]'::jsonb)) li
     WHERE created_at >= now() - interval '365 days'
       AND li->>'title' ILIKE 'F2F%' AND li->>'variant_id' IS NOT NULL
     ORDER BY li->>'variant_id', created_at DESC
  `);
  return r.rows.map(x => ({ variantId: String(x.vid), title: x.title, variantTitle: x.vtitle }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const [recipes, mappings, products] = await Promise.all([
      db.execute<{ id: number; name: string; is_core_menu: boolean; f2f_variant_id: string | null; f2f_product_title: string | null; f2f_variant_title: string | null }>(sql`
        SELECT id, name, is_core_menu, f2f_variant_id, f2f_product_title, f2f_variant_title FROM recipes
         WHERE archived_at IS NULL AND (is_core_menu OR f2f_variant_id IS NOT NULL) ORDER BY name`),
      db.execute<{ recipe_id: number; title: string | null }>(sql`SELECT recipe_id, shopify_product_title AS title FROM recipe_shopify_mappings`),
      f2fProducts(),
    ]);
    const titles = new Map<number, string[]>();
    for (const m of mappings.rows) if (m.title) titles.set(Number(m.recipe_id), [...(titles.get(Number(m.recipe_id)) ?? []), m.title]);
    const taken = new Set(recipes.rows.map(r => r.f2f_variant_id).filter((v): v is string => !!v));
    const out = recipes.rows.map(r => ({
      recipeId: Number(r.id), name: r.name.trim(), isCoreMenu: r.is_core_menu,
      f2f: r.f2f_variant_id ? { variantId: r.f2f_variant_id, title: r.f2f_product_title ?? "", variantTitle: r.f2f_variant_title } : null,
      suggestion: r.f2f_variant_id ? null : suggestF2f({ name: r.name, productTitles: titles.get(Number(r.id)) ?? [] }, products, taken),
    }));
    res.json({ recipes: out, products, missing: out.filter(r => r.isCoreMenu && !r.f2f).length });
  } catch (err) {
    console.error("[recipe-f2f] list failed:", err);
    res.status(500).json({ error: "Couldn't load the F2F links" });
  }
});

const linkBody = z.object({
  variantId: z.string().regex(/^\d{5,20}$/, "Not a Shopify variant id").nullable(),
  productTitle: z.string().max(300).nullish(),
  variantTitle: z.string().max(300).nullish(),
});

router.put("/:recipeId", validate(linkBody), async (req: Request, res: Response) => {
  const recipeId = Number(req.params.recipeId);
  if (!Number.isInteger(recipeId) || recipeId <= 0) { res.status(400).json({ error: "Bad recipe" }); return; }
  const b = req.body as z.infer<typeof linkBody>;
  try {
    if (b.variantId) {
      const other = await db.execute<{ id: number; name: string }>(sql`SELECT id, name FROM recipes WHERE f2f_variant_id = ${b.variantId} AND id <> ${recipeId}`);
      if (other.rows[0]) { res.status(409).json({ error: `That F2F product is already linked to ${other.rows[0].name.trim()}.` }); return; }
    }
    const r = await db.execute(sql`
      UPDATE recipes SET f2f_variant_id = ${b.variantId}, f2f_product_title = ${b.variantId ? b.productTitle ?? null : null},
             f2f_variant_title = ${b.variantId ? b.variantTitle ?? null : null}
       WHERE id = ${recipeId}`);
    if (!r.rowCount) { res.status(404).json({ error: "No such recipe" }); return; }
    forgetRecipeMappings();
    res.json({ ok: true });
  } catch (err) {
    console.error("[recipe-f2f] link failed:", err);
    res.status(500).json({ error: "Couldn't save the link" });
  }
});

export default router;

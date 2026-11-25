/**
 * F2F (frozen) product links (Graeme, 25 Nov 2026): "I basically need to be
 * able to set an F2F mapped product against all core recipes because they
 * all carry exactly the same cost as the original recipe … We need to flag
 * if we don't have an F2F map product."
 *
 *   GET /api/recipe-f2f              core recipes with their F2F link, a
 *                                    suggested match, and the F2F products
 *                                    seen on orders (the list to pick from)
 *   GET /api/recipe-f2f/:recipeId    one recipe's link + suggestion (its Shopify section)
 *   PUT /api/recipe-f2f/:recipeId    { variantId, productTitle, variantTitle } | { variantId: null }
 *   GET  /api/recipe-f2f/:recipeId/create-preview?mainProductId=
 *                                    "Create F2F product": exactly what would
 *                                    be made from the recipe's main product
 *                                    (reads only) — lib/f2f-product.ts
 *   POST /api/recipe-f2f/:recipeId/create  { expectedTitle, mainProductId? }
 *                                    make it (guarded Shopify writes), then
 *                                    link it to the recipe; who made it is
 *                                    recorded (f2f_product_creations)
 *
 * Managers and admins. The link makes Order Analysis and the P&L cost F2F
 * sales as the recipe (lib/pnl-calculator.ts), and is where the fridge →
 * freezer move will add stock. Matching rule: lib/recipe-f2f.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { validate, validateQuery } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { suggestF2f, type F2fProduct } from "../lib/recipe-f2f";
import { setRecipeF2fLink } from "../lib/recipe-f2f-link";
import { RunRefused, previewF2fCreate, runF2fCreate } from "../lib/f2f-product";
import { liveShopify } from "../lib/test-box-shopify";
import { ShopifyWritesBlockedError, shopifyWritesBlocked } from "../services/shopify";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

// One recipe's F2F link, for the recipe's own Shopify section (Graeme,
// 25 Nov 2026: "create F2F product and link F2F product" right beside the
// main Shopify link). Works for any recipe, core or not.
const OneParams = z.object({ recipeId: z.coerce.number().int().positive() });

router.get("/:recipeId", async (req: Request, res: Response) => {
  const p = OneParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Bad recipe" }); return; }
  const recipeId = p.data.recipeId;
  try {
    const [recipe, mappings, products] = await Promise.all([
      db.execute<{ id: number; name: string; is_core_menu: boolean; f2f_variant_id: string | null; f2f_product_title: string | null; f2f_variant_title: string | null }>(sql`
        SELECT id, name, is_core_menu, f2f_variant_id, f2f_product_title, f2f_variant_title FROM recipes WHERE id = ${recipeId}`),
      db.execute<{ title: string | null }>(sql`SELECT shopify_product_title AS title FROM recipe_shopify_mappings WHERE recipe_id = ${recipeId}`),
      f2fProducts(),
    ]);
    const r = recipe.rows[0];
    if (!r) { res.status(404).json({ error: "Recipe not found" }); return; }
    const takenRows = await db.execute<{ v: string }>(sql`SELECT f2f_variant_id AS v FROM recipes WHERE f2f_variant_id IS NOT NULL AND id <> ${recipeId}`);
    const taken = new Set(takenRows.rows.map(x => x.v));
    const titles = mappings.rows.map(m => m.title).filter((t): t is string => !!t);
    res.json({
      recipeId, name: r.name.trim(), isCoreMenu: r.is_core_menu,
      f2f: r.f2f_variant_id ? { variantId: r.f2f_variant_id, title: r.f2f_product_title ?? "", variantTitle: r.f2f_variant_title } : null,
      suggestion: r.f2f_variant_id ? null : suggestF2f({ name: r.name, productTitles: titles }, products, taken),
      takenVariantIds: [...taken],
    });
  } catch (err) {
    console.error("[recipe-f2f] one failed:", err);
    res.status(500).json({ error: "Couldn't load the F2F link" });
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
    const r = await setRecipeF2fLink(recipeId, b.variantId ? { variantId: b.variantId, productTitle: b.productTitle, variantTitle: b.variantTitle } : null);
    if (!r.ok) { res.status(r.status).json({ error: r.error }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[recipe-f2f] link failed:", err);
    res.status(500).json({ error: "Couldn't save the link" });
  }
});

// ── Create F2F product ──────────────────────────────────────────────────────
const IdParams = z.object({ recipeId: z.coerce.number().int().positive() });
const PreviewQuery = z.object({ mainProductId: z.string().regex(/^\d{1,20}$/).optional() });
const CreateBody = z.object({
  expectedTitle: z.string().min(1).max(300),
  mainProductId: z.string().regex(/^\d{1,20}$/).nullish(),
});

function createFail(res: Response, err: unknown, where: string) {
  if (err instanceof RunRefused) { res.status(err.status).json({ error: err.message }); return; }
  if (err instanceof ShopifyWritesBlockedError) { res.status(503).json({ error: err.message, code: err.code }); return; }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[recipe-f2f] ${where}:`, msg);
  res.status(502).json({ error: `Shopify problem: ${msg}` });
}

router.get("/:recipeId/create-preview", validateQuery(PreviewQuery), async (req: Request, res: Response) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Bad recipe" }); return; }
  const q = res.locals.query as z.infer<typeof PreviewQuery>;
  try {
    res.json(await previewF2fCreate(p.data.recipeId, q.mainProductId ?? null, liveShopify, shopifyWritesBlocked()));
  } catch (err) { createFail(res, err, "create preview"); }
});

router.post("/:recipeId/create", validate(CreateBody), async (req: Request, res: Response) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Bad recipe" }); return; }
  const b = req.body as z.infer<typeof CreateBody>;
  const userId = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  try {
    res.json(await runF2fCreate(p.data.recipeId, { expectedTitle: b.expectedTitle, mainProductId: b.mainProductId ?? null },
      { id: userId, name: u?.name ?? "Someone" }, liveShopify, shopifyWritesBlocked()));
  } catch (err) { createFail(res, err, "create"); }
});

export default router;

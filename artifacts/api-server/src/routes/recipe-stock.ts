/**
 * GET /api/recipe-stock — the two stock columns on the Recipes table (Graeme,
 * 25 Nov 2026: "what the current fridge stock is … how many we've currently
 * got in the fridge downstairs, and … how many we've got available for sale
 * on Shopify, which should be two different numbers").
 *
 *   fridgePacks  the production fridge's latest 2-pack count per recipe
 *                (stock_entries, location production_fridge, pack size 2 —
 *                the same read as the packing pick list, fulfilment-
 *                availability.ts)
 *   listings     each of the recipe's main Shopify listings (the 2-pack
 *                mapping, not wonky / 8-pack / F2F) with Shopify's own
 *                "available" number, whether stock is tracked, whether it
 *                keeps selling at 0, whether it's on the website, and the
 *                product's status — the screen decides what to show
 *                (lib/recipe-stock-cells.ts on the planner).
 *
 * Read only. Shopify is read at most once a minute; if it can't be reached
 * the last good answer is served, or the listings come back without numbers
 * and the screen says so. Objective C.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { shopifyGraphQL } from "../services/shopify";

const router: IRouter = Router();

export interface ShopifyListingStock {
  variantId: string;
  productTitle: string;
  variantTitle: string | null;
  status: string | null;      // ACTIVE | DRAFT | ARCHIVED, null when Shopify wasn't read
  tracked: boolean | null;
  /** DENY = stops selling at 0; CONTINUE = keeps selling past 0. */
  policy: string | null;
  /** Published to the Online Store, so customers can see it. */
  online: boolean | null;
  available: number | null;
}

interface VariantNode {
  id: string;
  title: string;
  inventoryPolicy: string | null;
  product: { title: string; status: string; publishedAt: string | null } | null;
  inventoryItem: {
    tracked: boolean;
    inventoryLevels: { nodes: Array<{ quantities: Array<{ name: string; quantity: number }> }> };
  } | null;
}

const TTL_MS = 60_000;
let cache: { at: number; key: string; map: Map<string, VariantNode> } | null = null;

async function readVariants(ids: string[]): Promise<{ map: Map<string, VariantNode>; ok: boolean }> {
  const key = [...ids].sort().join(",");
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return { map: cache.map, ok: true };
  try {
    const map = new Map<string, VariantNode>();
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const data = await shopifyGraphQL<{ nodes: Array<VariantNode | null> }>(
        `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant {
          id title inventoryPolicy product { title status publishedAt }
          inventoryItem { tracked inventoryLevels(first: 10) { nodes { quantities(names: ["available"]) { name quantity } } } }
        } } }`,
        { ids: chunk.map(id => `gid://shopify/ProductVariant/${id}`) },
      );
      for (const n of data.nodes ?? []) if (n?.id) map.set(n.id.split("/").pop()!, n);
    }
    cache = { at: Date.now(), key, map };
    return { map, ok: true };
  } catch (err) {
    console.warn("[recipe-stock] Shopify read failed:", err instanceof Error ? err.message : err);
    if (cache && cache.key === key) return { map: cache.map, ok: true };
    return { map: new Map(), ok: false };
  }
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const [fridge, mappings] = await Promise.all([
      db.execute<{ recipe_id: number; packs: string }>(sql`
        SELECT DISTINCT ON (se.recipe_id) se.recipe_id, se.quantity AS packs
          FROM stock_entries se
         WHERE se.recipe_id IS NOT NULL AND se.location = 'production_fridge' AND se.pack_size = 2
         ORDER BY se.recipe_id, se.checked_at DESC`),
      db.execute<{ recipe_id: number; vid: string; ptitle: string | null; vtitle: string | null }>(sql`
        SELECT recipe_id, shopify_variant_id AS vid, shopify_product_title AS ptitle, shopify_variant_title AS vtitle
          FROM recipe_shopify_mappings WHERE shopify_variant_id IS NOT NULL ORDER BY id`),
    ]);
    const ids = [...new Set(mappings.rows.map(m => String(m.vid)))];
    const { map, ok } = await readVariants(ids);

    const byRecipe = new Map<number, { fridgePacks: number | null; listings: ShopifyListingStock[] }>();
    const row = (id: number) => {
      let r = byRecipe.get(id);
      if (!r) { r = { fridgePacks: null, listings: [] }; byRecipe.set(id, r); }
      return r;
    };
    for (const f of fridge.rows) row(Number(f.recipe_id)).fridgePacks = Math.max(0, Math.round(Number(f.packs) || 0));
    for (const m of mappings.rows) {
      const n = map.get(String(m.vid));
      const levels = n?.inventoryItem?.inventoryLevels?.nodes ?? [];
      const available = n ? levels.reduce((s, l) => s + (l.quantities.find(q => q.name === "available")?.quantity ?? 0), 0) : null;
      row(Number(m.recipe_id)).listings.push({
        variantId: String(m.vid),
        productTitle: n?.product?.title ?? m.ptitle ?? "Shopify product",
        variantTitle: n ? (n.title === "Default Title" ? null : n.title) : m.vtitle,
        status: n?.product?.status ?? null,
        tracked: n?.inventoryItem ? n.inventoryItem.tracked : null,
        policy: n?.inventoryPolicy ?? null,
        online: n?.product ? n.product.publishedAt != null : null,
        available,
      });
    }
    res.json({
      shopifyRead: ok,
      recipes: [...byRecipe.entries()].map(([recipeId, r]) => ({ recipeId, ...r })),
    });
  } catch (err) {
    console.error("[recipe-stock] failed:", err);
    res.status(500).json({ error: "Couldn't load stock" });
  }
});

export default router;

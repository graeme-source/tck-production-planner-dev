import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// Fridge availability data for the fulfilment pick list (Objective B: what
// the bench can pack is driven by what is actually wrapped and in the
// production fridge, not hope).
//
// The page allocates stock to orders CLIENT-side, in the same order the
// pick list is displayed (filters + oldest/newest-first affect allocation),
// so this endpoint only supplies the raw facts:
//   - current 2-pack fridge stock per recipe (latest production_fridge
//     stock_entries row per recipe, packSize = 2 — the same read model as
//     the factory-number calc in routes/stock.ts)
//   - the Shopify variant → recipe map, including wonky variants (1 pack
//     per unit). 8-pack bag variants are intentionally excluded — see the
//     comment on the map below.
//   - the current special recipe, because "Calzone Club Special" order lines
//     carry the special's product title, not the recipe's own mapping
//     (same title-routing as lib/inventory-sync.ts).
const router: IRouter = Router();

router.get("/fridge-availability", async (_req, res) => {
  try {
    const stockRes = await db.execute<{ recipe_id: number; recipe_name: string; packs: string }>(sql`
      SELECT DISTINCT ON (se.recipe_id)
             se.recipe_id, r.name AS recipe_name, se.quantity AS packs
      FROM stock_entries se
      JOIN recipes r ON r.id = se.recipe_id
      WHERE se.recipe_id IS NOT NULL
        AND se.location = 'production_fridge'
        AND se.pack_size = 2
      ORDER BY se.recipe_id, se.checked_at DESC
    `);

    const variantRes = await db.execute<{
      recipe_id: number;
      recipe_name: string;
      shopify_variant_id: string | null;
      wonky_variant_id: string | null;
    }>(sql`
      SELECT m.recipe_id, r.name AS recipe_name, m.shopify_variant_id, m.wonky_variant_id
      FROM recipe_shopify_mappings m
      JOIN recipes r ON r.id = m.recipe_id
      -- Gate ONLY on products whose stock the production fridge actually
      -- tracks: core-menu recipes and fridge-held products (core + test
      -- calzones). Freezer lines (fried chicken, cinnamon buns) and bottled
      -- items (mayo, hot sauce) have no live fridge count, so gating on
      -- them held orders against fictional zeroes (Graeme, 2026-08-26).
      -- Unmapped lines never gate, so these now simply pass through.
      WHERE r.is_core_menu = TRUE OR r.is_fridge_product = TRUE
    `);

    const specialRes = await db.execute<{ id: number }>(sql`
      SELECT id FROM recipes WHERE is_current_special = TRUE LIMIT 1
    `);

    // variantId -> { recipeId, packsPerUnit }
    //
    // 8-pack bag variants are deliberately ABSENT: bags live in the fridge as
    // their own pack-size-8 stock, not in the 2-pack pool this endpoint
    // serves. Charging bag lines 4 two-packs each made every bag-heavy large
    // order look unfillable and starved the rest of the wave (2026-08-25 —
    // ten booked large orders, gate allowed two). Unmapped lines never gate,
    // so bag orders now stay pickable; the wholesale-bags flow owns their
    // real stock accounting.
    const variants: Record<string, { recipeId: number; packsPerUnit: number }> = {};
    // Names for EVERY mapped recipe — the deficit card must name a recipe
    // even when it has no fridge stock row (those are exactly the short
    // ones; "Recipe 29" means nothing to the wrapping team).
    const recipeNames: Record<number, string> = {};
    for (const row of variantRes.rows) {
      recipeNames[row.recipe_id] = row.recipe_name;
      if (row.shopify_variant_id) variants[row.shopify_variant_id] = { recipeId: row.recipe_id, packsPerUnit: 1 };
      if (row.wonky_variant_id) variants[row.wonky_variant_id] = { recipeId: row.recipe_id, packsPerUnit: 1 };
    }

    res.json({
      stock: stockRes.rows.map(r => ({
        recipeId: r.recipe_id,
        recipeName: r.recipe_name,
        packs: Math.max(0, Math.floor(Number(r.packs) || 0)),
      })),
      variants,
      recipeNames,
      specialRecipeId: specialRes.rows[0]?.id ?? null,
    });
  } catch (err) {
    console.error("[FulfilmentAvailability] error:", err);
    res.status(500).json({ error: "Could not load fridge availability" });
  }
});

export default router;

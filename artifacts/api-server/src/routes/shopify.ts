import { Router } from "express";
import { getOrdersByTag, getProducts, countProductsByTag } from "../services/shopify";
import { db, recipesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateTag(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const router = Router();

router.get("/products", async (req, res) => {
  try {
    const products = await getProducts();
    res.json(products);
  } catch (err: any) {
    console.error("[Shopify] products error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

router.get("/orders", async (req, res) => {
  const { tag } = req.query as { tag?: string };
  if (!tag) {
    res.status(400).json({ error: "tag query param required (e.g. ?tag=2026-03-20)" });
    return;
  }
  try {
    const orders = await getOrdersByTag(tag);
    res.json(orders);
  } catch (err: any) {
    console.error("[Shopify] orders error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

router.get("/order-summary", async (req, res) => {
  const { tag } = req.query as { tag?: string };
  if (!tag) {
    res.status(400).json({ error: "tag query param required (e.g. ?tag=2026-03-20)" });
    return;
  }
  try {
    const [[counts, orders], specialRows] = await Promise.all([
      Promise.all([countProductsByTag(tag), getOrdersByTag(tag)]),
      db.select({ id: recipesTable.id, name: recipesTable.name })
        .from(recipesTable)
        .where(eq(recipesTable.isCurrentSpecial, true))
        .limit(1),
    ]);

    const specialRecipe = specialRows[0] ?? null;
    const SPECIAL_KEY = "calzone club special";

    let products = counts;
    if (specialRecipe) {
      const specialEntry = counts.find(p => p.productTitle.toLowerCase().trim() === SPECIAL_KEY);
      if (specialEntry) {
        const specialQty = specialEntry.totalQuantity;
        const withoutSpecialEntry = products.filter(p => p.productTitle.toLowerCase().trim() !== SPECIAL_KEY);
        const existingIdx = withoutSpecialEntry.findIndex(p =>
          p.productTitle.toLowerCase().includes(specialRecipe.name.toLowerCase()) ||
          specialRecipe.name.toLowerCase().includes(p.productTitle.toLowerCase())
        );
        if (existingIdx !== -1) {
          products = withoutSpecialEntry.map((p, i) => i === existingIdx
            ? {
                ...p,
                totalQuantity: p.totalQuantity + specialQty,
                orderCount: p.orderCount + specialEntry.orderCount,
                specialCount: specialQty,
                variants: [...p.variants, ...specialEntry.variants],
              }
            : p
          );
        } else {
          products = [
            ...withoutSpecialEntry,
            { ...specialEntry, productTitle: specialRecipe.name, specialCount: specialQty },
          ];
        }
      }
    }

    res.json({
      tag,
      orderCount: orders.length,
      products,
      currentSpecialRecipeName: specialRecipe?.name ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Shopify] order-summary error:", msg);
    res.status(502).json({ error: msg });
  }
});

router.get("/weekly-orders", async (req, res) => {
  try {
    const weekStartParam = req.query.weekStart as string | undefined;
    let monday: Date;

    if (weekStartParam) {
      monday = new Date(weekStartParam + "T00:00:00");
    } else {
      const today = new Date();
      const dayOfWeek = today.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      monday = new Date(today);
      monday.setDate(today.getDate() + diff);
    }
    monday.setHours(0, 0, 0, 0);

    const results = await Promise.all(
      Array.from({ length: 7 }, async (_, i) => {
        const dispatchDay = new Date(monday);
        dispatchDay.setDate(monday.getDate() + i);

        const deliveryDay = new Date(monday);
        deliveryDay.setDate(monday.getDate() + i + 1);

        const tag = toDateTag(deliveryDay);
        const orders = await getOrdersByTag(tag);

        const fulfilledCount = orders.filter(o => o.fulfillment_status === "fulfilled").length;
        return {
          date: toDateTag(dispatchDay),
          deliveryDate: tag,
          day: DAY_NAMES[dispatchDay.getDay()],
          orderCount: orders.length,
          fulfilledCount,
          unfulfilledCount: orders.length - fulfilledCount,
        };
      })
    );

    res.json({ weekStart: toDateTag(monday), days: results });
  } catch (err: any) {
    console.error("[Shopify] weekly-orders error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── Recipe → Shopify variant mapping CRUD ────────────────────────────────────

// GET /recipe-mappings — all mappings with recipe names
router.get("/recipe-mappings", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT rsm.id, rsm.recipe_id, rsm.shopify_variant_id, rsm.shopify_product_title,
             rsm.shopify_variant_title, rsm.created_at, r.name AS recipe_name
      FROM recipe_shopify_mappings rsm
      JOIN recipes r ON rsm.recipe_id = r.id
      ORDER BY r.name
    `);
    res.json(rows.rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// GET /recipe-mappings/:recipeId — single mapping
router.get("/recipe-mappings/:recipeId", async (req, res) => {
  const recipeId = Number(req.params.recipeId);
  if (!Number.isInteger(recipeId) || recipeId < 1) {
    res.status(400).json({ error: "Invalid recipeId" });
    return;
  }
  try {
    const rows = await db.execute(sql`
      SELECT * FROM recipe_shopify_mappings WHERE recipe_id = ${recipeId}
    `);
    if (rows.rows.length === 0) { res.status(404).json({ error: "No mapping found for this recipe" }); return; }
    res.json(rows.rows[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// PUT /recipe-mappings/:recipeId — upsert mapping
router.put("/recipe-mappings/:recipeId", async (req, res) => {
  const recipeId = Number(req.params.recipeId);
  if (!Number.isInteger(recipeId) || recipeId < 1) {
    res.status(400).json({ error: "Invalid recipeId" });
    return;
  }
  const { shopifyVariantId, shopifyProductTitle, shopifyVariantTitle } = req.body as {
    shopifyVariantId?: string;
    shopifyProductTitle?: string;
    shopifyVariantTitle?: string;
  };
  if (!shopifyVariantId || typeof shopifyVariantId !== "string") {
    res.status(400).json({ error: "shopifyVariantId (string) is required" });
    return;
  }
  try {
    const [recipe] = await db.select({ id: recipesTable.id }).from(recipesTable).where(eq(recipesTable.id, recipeId));
    if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }

    await db.execute(sql`
      INSERT INTO recipe_shopify_mappings (recipe_id, shopify_variant_id, shopify_product_title, shopify_variant_title)
      VALUES (${recipeId}, ${shopifyVariantId}, ${shopifyProductTitle ?? null}, ${shopifyVariantTitle ?? null})
      ON CONFLICT (recipe_id) DO UPDATE SET
        shopify_variant_id    = EXCLUDED.shopify_variant_id,
        shopify_product_title = EXCLUDED.shopify_product_title,
        shopify_variant_title = EXCLUDED.shopify_variant_title
    `);
    const rows = await db.execute(sql`SELECT * FROM recipe_shopify_mappings WHERE recipe_id = ${recipeId}`);
    res.json(rows.rows[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// DELETE /recipe-mappings/:recipeId — remove mapping
router.delete("/recipe-mappings/:recipeId", async (req, res) => {
  const recipeId = Number(req.params.recipeId);
  if (!Number.isInteger(recipeId) || recipeId < 1) {
    res.status(400).json({ error: "Invalid recipeId" });
    return;
  }
  try {
    await db.execute(sql`DELETE FROM recipe_shopify_mappings WHERE recipe_id = ${recipeId}`);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;

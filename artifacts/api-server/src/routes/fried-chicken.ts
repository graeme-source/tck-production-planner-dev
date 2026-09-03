/**
 * Fried chicken production.
 *
 * Fried chicken runs separately from the calzone line, on its own days, and
 * has always been planned on a paper sheet. This is that sheet's brain
 * (Graeme, 2026-09-03).
 *
 * Shape of it:
 *   • The run is driven by kilos of RAW CHICKEN, the way calzones are driven
 *     by batches. 75 kg is the usual week and it is editable per plan.
 *   • Each variant costs whatever raw meat its recipe resolves to, so nothing
 *     here knows about strips. The old sheet counted strips because the
 *     weights weren't in the system; they are now.
 *   • The split between variants is a DPT share in PACKS, seeded from
 *     trailing sales, and the target is the stock AFTER the run — so a
 *     variant that has fallen behind gets the chicken and one sitting on a
 *     month's cover gets none.
 *   • The plan is a target. What actually gets made is counted at the station
 *     and THAT is what updates Shopify.
 *
 * Lives in its own router because the charter forbids new code in
 * routes/production-plans.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, recipesTable, productionPlansTable, productionPlanItemsTable,
  appSettingsTable, allocateFriedChickenPacks, dptSharesFromSales,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { resolveRecipeIngredients } from "../lib/ingredient-resolver";
import { getProducts, adjustInventoryLevel } from "../services/shopify";

const router: IRouter = Router();

export const FRIED_CHICKEN_CATEGORY = "Fried Chicken";

async function setting(key: string, fallback: string): Promise<string> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? fallback;
}

/** Raw meat one pack of this recipe costs.
 *
 *  Summed across every resolved ingredient in the raw_meat category rather
 *  than looking for an ingredient by name — the charter's rule, and it means
 *  a recipe swapping thigh for breast needs no code change. */
async function rawMeatKgPerPack(recipeId: number, portionsPerBatch: number): Promise<number> {
  const resolved = await resolveRecipeIngredients(recipeId, portionsPerBatch || 1);
  let kg = 0;
  for (const r of resolved) {
    if ((r.category ?? "") !== "raw_meat") continue;
    const q = Number(r.quantityPerBatch) || 0;
    kg += r.unit === "kg" ? q : r.unit === "g" ? q / 1000 : 0;
  }
  return kg;
}

interface FriedChickenVariant {
  recipeId: number;
  name: string;
  variantId: string | null;
  kgPerPack: number;
  stockPacks: number;
  soldLast30: number;
  dptShare: number;
}

/** The four (or however many) fried chicken recipes, with what each costs in
 *  raw meat, what Shopify has on the shelf, and what has been selling. */
async function loadVariants(): Promise<FriedChickenVariant[]> {
  const recipes = await db
    .select({ id: recipesTable.id, name: recipesTable.name, portionsPerBatch: recipesTable.portionsPerBatch })
    .from(recipesTable)
    .where(eq(recipesTable.category, FRIED_CHICKEN_CATEGORY));
  if (recipes.length === 0) return [];

  const ids = recipes.map(r => r.id);
  const mapRows = await db.execute<{ recipe_id: number; shopify_variant_id: string | null }>(sql`
    SELECT recipe_id, shopify_variant_id FROM recipe_shopify_mappings
    WHERE recipe_id = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})
  `);
  const variantOf = new Map<number, string>();
  for (const m of mapRows.rows ?? []) {
    if (m.shopify_variant_id) variantOf.set(Number(m.recipe_id), String(m.shopify_variant_id));
  }

  // Stock straight from Shopify's own inventory numbers.
  const stockOf = new Map<string, number>();
  try {
    for (const p of await getProducts()) {
      for (const v of p.variants ?? []) stockOf.set(String(v.id), Number(v.inventory_quantity) || 0);
    }
  } catch (err) {
    console.warn("[fried-chicken] Shopify stock unavailable, treating shelf as empty:", err instanceof Error ? err.message : err);
  }

  // Trailing sales per variant, from the local orders mirror.
  const windowDays = Number(await setting("fried_chicken_sales_window_days", "30")) || 30;
  const salesOf = new Map<string, number>();
  try {
    const rows = await db.execute<{ variant_id: string; units: number }>(sql`
      SELECT li->>'variant_id' AS variant_id, SUM((li->>'quantity')::int)::int AS units
      FROM shopify_orders_cache c, LATERAL jsonb_array_elements(c.payload->'line_items') li
      WHERE c.created_at >= NOW() - (${windowDays} || ' days')::interval
        AND li->>'variant_id' IS NOT NULL
      GROUP BY 1
    `);
    for (const r of rows.rows ?? []) salesOf.set(String(r.variant_id), Number(r.units) || 0);
  } catch (err) {
    console.warn("[fried-chicken] sales history unavailable:", err instanceof Error ? err.message : err);
  }

  const base = await Promise.all(recipes.map(async r => {
    const variantId = variantOf.get(r.id) ?? null;
    return {
      recipeId: r.id,
      name: r.name,
      variantId,
      kgPerPack: await rawMeatKgPerPack(r.id, Number(r.portionsPerBatch) || 1),
      stockPacks: variantId ? (stockOf.get(variantId) ?? 0) : 0,
      soldLast30: variantId ? (salesOf.get(variantId) ?? 0) : 0,
      dptShare: 0,
    };
  }));

  // DPT from sales. If nothing has sold (or nothing is mapped yet) fall back
  // to an even split so the screen still does something sensible.
  const shares = dptSharesFromSales(Object.fromEntries(base.map(v => [String(v.recipeId), v.soldLast30])));
  const anySales = base.some(v => v.soldLast30 > 0);
  for (const v of base) v.dptShare = anySales ? (shares[String(v.recipeId)] ?? 0) : 1 / base.length;
  return base;
}

// GET /fried-chicken/suggestion?rawKg=75 — what a run of this size should make.
router.get("/suggestion", async (req: Request, res: Response) => {
  try {
    const defaultKg = Number(await setting("fried_chicken_default_raw_kg", "75")) || 75;
    const rawKg = Number(req.query.rawKg) > 0 ? Number(req.query.rawKg) : defaultKg;

    const variants = await loadVariants();
    if (variants.length === 0) {
      res.json({ rawKg, defaultKg, variants: [], totalPacks: 0, unmapped: [], oilKg: 0 });
      return;
    }

    const alloc = allocateFriedChickenPacks(
      variants.map(v => ({ key: String(v.recipeId), dptShare: v.dptShare, kgPerPack: v.kgPerPack, stockPacks: v.stockPacks })),
      rawKg,
    );
    const packsOf = new Map(alloc.variants.map(a => [a.key, a]));
    const oilPerKg = Number(await setting("fried_chicken_oil_kg_per_kg", "0.457")) || 0.457;

    res.json({
      rawKg,
      defaultKg,
      oilKg: Math.round(rawKg * oilPerKg * 10) / 10,
      totalPacks: alloc.totalPacks,
      kgUsed: alloc.kgUsed,
      kgSpare: alloc.kgSpare,
      // Anything the maths can't see, said out loud rather than silently
      // treated as zero: a recipe with no Shopify link has no stock and no
      // sales, and one with no raw meat can't cost anything.
      unmapped: variants.filter(v => !v.variantId).map(v => v.name),
      noMeat: variants.filter(v => v.kgPerPack <= 0).map(v => v.name),
      variants: variants.map(v => ({
        recipeId: v.recipeId,
        name: v.name,
        stockPacks: v.stockPacks,
        soldLast30: v.soldLast30,
        dptPercent: Math.round(v.dptShare * 1000) / 10,
        kgPerPack: Math.round(v.kgPerPack * 1000) / 1000,
        packs: packsOf.get(String(v.recipeId))?.packs ?? 0,
        stockAfter: packsOf.get(String(v.recipeId))?.stockAfter ?? v.stockPacks,
        daysCoverNow: v.soldLast30 > 0 ? Math.round(v.stockPacks / (v.soldLast30 / 30) * 10) / 10 : null,
      })),
    });
  } catch (err) {
    console.error("[fried-chicken] suggestion failed:", err);
    res.status(500).json({ error: "Couldn't work out a suggestion" });
  }
});

// POST /fried-chicken/plans/:planId/items — put the chosen bags on a plan.
// Treated as the desired final state for fried chicken on this plan, the same
// way adding mac cheese works, so it doubles as the edit path.
const ItemsBody = z.object({
  rawKg: z.number().positive().max(2000).optional(),
  items: z.array(z.object({
    recipeId: z.number().int(),
    packs: z.number().int().min(0).max(5000),
  })).min(1),
});

router.post("/plans/:planId/items", requireManagerOrAdmin, validate(ItemsBody), async (req: Request, res: Response) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const body = req.body as z.infer<typeof ItemsBody>;

  try {
    const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, planId));
    if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

    const recipeIds = body.items.map(i => i.recipeId);
    const recipes = await db
      .select({ id: recipesTable.id, category: recipesTable.category, portionsPerBatch: recipesTable.portionsPerBatch, packSize: recipesTable.packSize })
      .from(recipesTable)
      .where(inArray(recipesTable.id, recipeIds));
    const byId = new Map(recipes.map(r => [r.id, r]));
    for (const it of body.items) {
      const r = byId.get(it.recipeId);
      if (!r) { res.status(400).json({ error: `Recipe ${it.recipeId} not found` }); return; }
      if (r.category !== FRIED_CHICKEN_CATEGORY) {
        res.status(400).json({ error: `${it.recipeId} is not a fried chicken recipe` });
        return;
      }
    }

    const existing = await db
      .select({ id: productionPlanItemsTable.id, recipeId: productionPlanItemsTable.recipeId, batchesComplete: productionPlanItemsTable.batchesComplete })
      .from(productionPlanItemsTable)
      .where(and(
        eq(productionPlanItemsTable.planId, planId),
        inArray(productionPlanItemsTable.recipeId, recipes.map(r => r.id)),
      ));
    const existingByRecipe = new Map(existing.map(e => [e.recipeId, e]));

    let maxPos = 0;
    const [posRow] = await db
      .select({ n: sql<number>`COALESCE(MAX(${productionPlanItemsTable.orderPosition}), 0)` })
      .from(productionPlanItemsTable)
      .where(eq(productionPlanItemsTable.planId, planId));
    maxPos = Number(posRow?.n ?? 0);

    const kept: number[] = [];
    for (const it of body.items) {
      const r = byId.get(it.recipeId)!;
      const prior = existingByRecipe.get(it.recipeId);
      if (prior) {
        await db.update(productionPlanItemsTable)
          .set({ batchesTarget: it.packs })
          .where(eq(productionPlanItemsTable.id, prior.id));
        kept.push(prior.id);
      } else if (it.packs > 0) {
        const [row] = await db.insert(productionPlanItemsTable).values({
          planId,
          recipeId: it.recipeId,
          batchesTarget: it.packs,
          // One bag is one unit of production here — the recipes are written
          // per pack, so a batch IS a pack. portions-per-batch lives on the
          // recipe, not the plan item.
          orderPosition: ++maxPos,
        }).returning({ id: productionPlanItemsTable.id });
        if (row) kept.push(row.id);
      }
    }

    // Anything dropped from the list goes, unless it has work against it —
    // never delete something somebody has already fried.
    const blocked: number[] = [];
    for (const e of existing) {
      if (kept.includes(e.id)) continue;
      if ((Number(e.batchesComplete) || 0) > 0) { blocked.push(e.id); continue; }
      await db.delete(productionPlanItemsTable).where(eq(productionPlanItemsTable.id, e.id));
    }

    res.json({ ok: true, planId, itemsKept: kept.length, notRemoved: blocked });
  } catch (err) {
    console.error("[fried-chicken] add items failed:", err);
    res.status(500).json({ error: "Couldn't add fried chicken to the plan" });
  }
});

// GET /fried-chicken/plans/:planId/prep — everything the prep day needs.
router.get("/plans/:planId/prep", async (req: Request, res: Response) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }
  try {
    const items = await db
      .select({
        id: productionPlanItemsTable.id,
        recipeId: productionPlanItemsTable.recipeId,
        batchesTarget: productionPlanItemsTable.batchesTarget,
        portionsPerBatch: recipesTable.portionsPerBatch,
        recipeName: recipesTable.name,
      })
      .from(productionPlanItemsTable)
      .leftJoin(recipesTable, eq(recipesTable.id, productionPlanItemsTable.recipeId))
      .where(and(
        eq(productionPlanItemsTable.planId, planId),
        eq(recipesTable.category, FRIED_CHICKEN_CATEGORY),
      ));

    const totals = new Map<string, { name: string; unit: string; qty: number; category: string | null }>();
    let rawMeatKg = 0;
    for (const it of items) {
      if (!it.recipeId) continue;
      const packs = Number(it.batchesTarget) || 0;
      if (packs <= 0) continue;
      const resolved = await resolveRecipeIngredients(it.recipeId, Number(it.portionsPerBatch) || 1);
      for (const r of resolved) {
        const q = (Number(r.quantityPerBatch) || 0) * packs;
        if (q <= 0) continue;
        const key = `${r.ingredientId}`;
        const prev = totals.get(key);
        totals.set(key, {
          name: r.ingredientName,
          unit: r.unit,
          category: r.category ?? null,
          qty: (prev?.qty ?? 0) + q,
        });
        if ((r.category ?? "") === "raw_meat") {
          rawMeatKg += r.unit === "kg" ? q : r.unit === "g" ? q / 1000 : 0;
        }
      }
    }

    const oilPerKg = Number(await setting("fried_chicken_oil_kg_per_kg", "0.457")) || 0.457;
    res.json({
      planId,
      packs: items.reduce((n, i) => n + (Number(i.batchesTarget) || 0), 0),
      rawMeatKg: Math.round(rawMeatKg * 1000) / 1000,
      // Not an ingredient — this is what has to be in the fryers to cook
      // with. Most of it ends the day as waste; the bit that ends up in the
      // food is already in the recipes.
      oilOnSiteKg: Math.round(rawMeatKg * oilPerKg * 10) / 10,
      oilKgPerKgChicken: oilPerKg,
      ingredients: [...totals.values()]
        .map(t => ({ ...t, qty: Math.round(t.qty * 1000) / 1000 }))
        .sort((a, b) => b.qty - a.qty),
    });
  } catch (err) {
    console.error("[fried-chicken] prep failed:", err);
    res.status(500).json({ error: "Couldn't work out the prep" });
  }
});

// POST /fried-chicken/plans/:planId/submit-stock — push what was COUNTED (not
// the target) into Shopify's available stock.
//
// This is the only thing here that writes outside the building, so it is
// deliberately explicit: a dry run by default, and it reports every variant's
// before and after so the first real one can be checked against Shopify's own
// inventory history.
const SubmitBody = z.object({ confirm: z.boolean().optional() });

router.post("/plans/:planId/submit-stock", requireManagerOrAdmin, validate(SubmitBody), async (req: Request, res: Response) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const confirm = (req.body as z.infer<typeof SubmitBody>).confirm === true;

  try {
    const items = await db
      .select({
        recipeId: productionPlanItemsTable.recipeId,
        made: productionPlanItemsTable.batchesComplete,
        target: productionPlanItemsTable.batchesTarget,
        recipeName: recipesTable.name,
      })
      .from(productionPlanItemsTable)
      .leftJoin(recipesTable, eq(recipesTable.id, productionPlanItemsTable.recipeId))
      .where(and(
        eq(productionPlanItemsTable.planId, planId),
        eq(recipesTable.category, FRIED_CHICKEN_CATEGORY),
      ));

    if (items.length === 0) { res.status(400).json({ error: "No fried chicken on this plan" }); return; }

    const mapRows = await db.execute<{ recipe_id: number; shopify_variant_id: string | null }>(sql`
      SELECT recipe_id, shopify_variant_id FROM recipe_shopify_mappings
    `);
    const variantOf = new Map<number, string>();
    for (const m of mapRows.rows ?? []) {
      if (m.shopify_variant_id) variantOf.set(Number(m.recipe_id), String(m.shopify_variant_id));
    }

    const plan: Array<{ recipeName: string; variantId: string | null; made: number; target: number; result?: string; newQuantity?: number }> =
      items.map(i => ({
        recipeName: i.recipeName ?? `Recipe ${i.recipeId}`,
        variantId: i.recipeId ? (variantOf.get(i.recipeId) ?? null) : null,
        made: Number(i.made) || 0,
        target: Number(i.target) || 0,
      }));

    if (!confirm) {
      res.json({ dryRun: true, planId, adjustments: plan });
      return;
    }

    for (const row of plan) {
      if (!row.variantId) { row.result = "no Shopify variant linked — skipped"; continue; }
      if (row.made <= 0) { row.result = "nothing counted — skipped"; continue; }
      try {
        const out = await adjustInventoryLevel(row.variantId, row.made);
        row.newQuantity = out.newQuantity;
        row.result = "added";
        console.log(`[fried-chicken] Shopify +${row.made} for ${row.recipeName} -> ${out.newQuantity}`);
      } catch (err) {
        row.result = `failed: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[fried-chicken] Shopify adjust failed for ${row.recipeName}:`, err);
      }
    }
    res.json({ dryRun: false, planId, adjustments: plan });
  } catch (err) {
    console.error("[fried-chicken] submit stock failed:", err);
    res.status(500).json({ error: "Couldn't submit stock" });
  }
});

export default router;

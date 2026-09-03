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

// GET /fried-chicken/next-run?after=YYYY-MM-DD — the next plan that actually
// carries fried chicken.
//
// Chicken prep happens the day BEFORE the run, so whoever is prepping is
// standing on one plan and needs the numbers off another. Rather than make
// every screen walk the plan list looking for chicken, the question is asked
// once here: what is the next run, and is today its prep day?
router.get("/next-run", async (req: Request, res: Response) => {
  try {
    const after = typeof req.query.after === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.after)
      ? req.query.after
      : null;
    if (!after) { res.status(400).json({ error: "after=YYYY-MM-DD is required" }); return; }

    const daysBefore = Number(await setting("fried_chicken_prep_days_before", "1"));

    // The next plan on or after `after` with at least one fried chicken item
    // still targeted. "On or after" rather than strictly after, because the
    // prep-day question is asked from the prep day itself.
    const [row] = await db
      .select({
        id: productionPlansTable.id,
        name: productionPlansTable.name,
        planDate: productionPlansTable.planDate,
        packs: sql<number>`SUM(${productionPlanItemsTable.batchesTarget})::int`,
      })
      .from(productionPlansTable)
      .innerJoin(productionPlanItemsTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
      .innerJoin(recipesTable, eq(recipesTable.id, productionPlanItemsTable.recipeId))
      .where(and(
        sql`${productionPlansTable.planDate} >= ${after}::date`,
        eq(recipesTable.category, FRIED_CHICKEN_CATEGORY),
      ))
      .groupBy(productionPlansTable.id, productionPlansTable.name, productionPlansTable.planDate)
      .having(sql`SUM(${productionPlanItemsTable.batchesTarget}) > 0`)
      .orderBy(productionPlansTable.planDate)
      .limit(1);

    if (!row) { res.json({ found: false }); return; }

    // The prep day for that run, from the same setting the plan page uses.
    const prepDate = new Date(`${row.planDate}T12:00:00Z`);
    prepDate.setUTCDate(prepDate.getUTCDate() - (Number.isFinite(daysBefore) ? daysBefore : 1));
    const prepDateStr = prepDate.toISOString().slice(0, 10);

    res.json({
      found: true,
      planId: row.id,
      planName: row.name,
      planDate: row.planDate,
      prepDate: prepDateStr,
      packs: Number(row.packs) || 0,
      isPrepDay: prepDateStr === after,
      isRunDay: row.planDate === after,
    });
  } catch (err) {
    console.error("[fried-chicken] next-run failed:", err);
    res.status(500).json({ error: "Couldn't find the next chicken run" });
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

    // EVERY fried chicken line already on this plan, not only the ones the
    // body mentions. Scoping this to the submitted recipes meant a variant
    // dropped from the list was never loaded, so the removal loop below could
    // never see it and nothing was ever removed — the endpoint documented
    // itself as the edit path while only ever being the add path.
    const existing = await db
      .select({
        id: productionPlanItemsTable.id,
        recipeId: productionPlanItemsTable.recipeId,
        batchesComplete: productionPlanItemsTable.batchesComplete,
      })
      .from(productionPlanItemsTable)
      .innerJoin(recipesTable, eq(recipesTable.id, productionPlanItemsTable.recipeId))
      .where(and(
        eq(productionPlanItemsTable.planId, planId),
        eq(recipesTable.category, FRIED_CHICKEN_CATEGORY),
      ));
    const existingByRecipe = new Map(existing.map(e => [e.recipeId, e]));

    let maxPos = 0;
    const [posRow] = await db
      .select({ n: sql<number>`COALESCE(MAX(${productionPlanItemsTable.orderPosition}), 0)` })
      .from(productionPlanItemsTable)
      .where(eq(productionPlanItemsTable.planId, planId));
    maxPos = Number(posRow?.n ?? 0);

    // Zero bags means "not on the plan" — the planner took it off, and a line
    // sitting at a target of zero would still show up at the station asking to
    // be counted. So a submitted zero is a removal, same as leaving it out.
    const wanted = new Map(body.items.map(i => [i.recipeId, Math.max(0, i.packs)]));

    const kept: number[] = [];
    const blocked: number[] = [];

    for (const e of existing) {
      const packs = wanted.get(e.recipeId) ?? 0;
      const made = Number(e.batchesComplete) || 0;
      if (packs > 0) {
        await db.update(productionPlanItemsTable)
          .set({ batchesTarget: packs })
          .where(eq(productionPlanItemsTable.id, e.id));
        kept.push(e.id);
        continue;
      }
      // Never delete something somebody has already fried, and leave its
      // target alone rather than zeroing what the count sheet reads against.
      if (made > 0) { blocked.push(e.id); kept.push(e.id); continue; }
      await db.delete(productionPlanItemsTable).where(eq(productionPlanItemsTable.id, e.id));
    }

    for (const it of body.items) {
      if (it.packs <= 0 || existingByRecipe.has(it.recipeId)) continue;
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

    res.json({ ok: true, planId, itemsKept: kept.length, notRemoved: blocked });
  } catch (err) {
    console.error("[fried-chicken] add items failed:", err);
    res.status(500).json({ error: "Couldn't add fried chicken to the plan" });
  }
});

// POST /fried-chicken/plans/:planId/count — one more bag, or one fewer.
//
// The calzone line counts through /production-plans/:id/batch-completions,
// which moves batches_complete only at the WRAPPING station: a calzone is not
// "made" until it has been through the ovens and wrapped. Fried chicken has no
// such pipeline — a bag comes off the fryer, gets weighed and sealed, and it
// exists. Counting it here rather than bending the calzone rule keeps both
// truthful, and the charter closes routes/production-plans.ts to new code
// anyway.
//
// A batch_completions row still goes in alongside, so the station shows who
// has been working it, the same as everywhere else.
const CountBody = z.object({
  planItemId: z.number().int(),
  delta: z.union([z.literal(1), z.literal(-1)]),
});

router.post("/plans/:planId/count", validate(CountBody), async (req: Request, res: Response) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const { planItemId, delta } = req.body as z.infer<typeof CountBody>;

  try {
    const [item] = await db
      .select({
        id: productionPlanItemsTable.id,
        made: productionPlanItemsTable.batchesComplete,
        category: recipesTable.category,
      })
      .from(productionPlanItemsTable)
      .leftJoin(recipesTable, eq(recipesTable.id, productionPlanItemsTable.recipeId))
      .where(and(
        eq(productionPlanItemsTable.id, planItemId),
        eq(productionPlanItemsTable.planId, planId),
      ));

    if (!item) { res.status(400).json({ error: "That line isn't on this plan" }); return; }
    if (item.category !== FRIED_CHICKEN_CATEGORY) {
      res.status(400).json({ error: "That line isn't fried chicken" });
      return;
    }

    const before = Number(item.made) || 0;
    if (delta === -1 && before === 0) { res.json({ made: 0 }); return; }

    // Floor at zero in SQL as well as here — two people counting on two
    // iPads is the normal case at this station.
    const [row] = await db.execute<{ batches_complete: number }>(sql`
      UPDATE production_plan_items
      SET batches_complete = GREATEST(0, batches_complete + ${delta}),
          status = 'in-progress'
      WHERE id = ${planItemId}
      RETURNING batches_complete
    `).then(r => r.rows ?? []);

    const userId = req.session.userId ?? null;
    if (delta === 1) {
      await db.execute(sql`
        INSERT INTO batch_completions (plan_item_id, station_type, user_id, completed_at)
        VALUES (${planItemId}, 'fried_chicken', ${userId}, NOW())
      `);
    } else {
      // Take back this person's own most recent bag, not somebody else's.
      await db.execute(sql`
        DELETE FROM batch_completions
        WHERE id = (
          SELECT id FROM batch_completions
          WHERE plan_item_id = ${planItemId}
            AND station_type = 'fried_chicken'
            AND (${userId}::int IS NULL OR user_id = ${userId})
          ORDER BY completed_at DESC
          LIMIT 1
        )
      `);
    }

    res.json({ made: Number(row?.batches_complete ?? Math.max(0, before + delta)) });
  } catch (err) {
    console.error("[fried-chicken] count failed:", err);
    res.status(500).json({ error: "Couldn't record that bag" });
  }
});

// GET /fried-chicken/plans/:planId/prep — everything the prep day needs.
router.get("/plans/:planId/prep", async (req: Request, res: Response) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }
  try {
    const [plan] = await db
      .select({ name: productionPlansTable.name, planDate: productionPlansTable.planDate })
      .from(productionPlansTable)
      .where(eq(productionPlansTable.id, planId));
    if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

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
      planName: plan.name,
      planDate: plan.planDate,
      bags: items
        .filter(i => (Number(i.batchesTarget) || 0) > 0)
        .map(i => ({ recipeName: i.recipeName ?? `Recipe ${i.recipeId}`, packs: Number(i.batchesTarget) || 0 }))
        .sort((a, b) => b.packs - a.packs),
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
//
// It ADDS the counted bags, so running it twice on the same day silently
// doubles the shelf — the sort of mistake that is only found days later when
// a customer orders something that isn't there. A confirmed run is therefore
// recorded, and a second one is refused unless it is explicitly forced. The
// guard lives here rather than in the screen because there is more than one
// way to reach the endpoint.
const SubmitBody = z.object({
  confirm: z.boolean().optional(),
  /** Send again even though this plan's stock has already gone. For the case
   *  where the first run half-failed and the rest is genuinely still owed. */
  force: z.boolean().optional(),
});

interface PriorSubmission { at: string; by: number | null; bags: number }

function submissionKey(planId: number): string {
  return `fried_chicken_stock_submitted_${planId}`;
}

async function priorSubmission(planId: number): Promise<PriorSubmission | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, submissionKey(planId)));
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as PriorSubmission;
    return typeof parsed?.at === "string" ? parsed : null;
  } catch {
    return null;
  }
}

router.post("/plans/:planId/submit-stock", requireManagerOrAdmin, validate(SubmitBody), async (req: Request, res: Response) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const body = req.body as z.infer<typeof SubmitBody>;
  const confirm = body.confirm === true;
  const force = body.force === true;

  try {
    const already = await priorSubmission(planId);
    if (confirm && already && !force) {
      res.status(409).json({
        error: "This plan's counted bags have already gone to Shopify",
        alreadySubmitted: already,
      });
      return;
    }

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
      res.json({ dryRun: true, planId, adjustments: plan, alreadySubmitted: already });
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
    // Record the run only if something actually landed. A submission where
    // every line failed has changed nothing outside the building, so blocking
    // the retry would strand the day's stock.
    const bagsSent = plan.reduce((n, r) => n + (r.result === "added" ? r.made : 0), 0);
    if (bagsSent > 0) {
      const record: PriorSubmission = {
        at: new Date().toISOString(),
        by: req.session.userId ?? null,
        bags: bagsSent,
      };
      await db.insert(appSettingsTable)
        .values({ key: submissionKey(planId), value: JSON.stringify(record) })
        .onConflictDoUpdate({
          target: appSettingsTable.key,
          set: { value: JSON.stringify(record), updatedAt: new Date() },
        });
    }

    res.json({ dryRun: false, planId, adjustments: plan, bagsSent, resent: force && already !== null });
  } catch (err) {
    console.error("[fried-chicken] submit stock failed:", err);
    res.status(500).json({ error: "Couldn't submit stock" });
  }
});

export default router;

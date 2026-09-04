import { Router, type IRouter } from "express";
import { db, subRecipesTable, subRecipeIngredientsTable, subRecipeSubRecipesTable, ingredientsTable, kanbanItemsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CreateSubRecipeBody, UpdateSubRecipeBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";
import { computeSubRecipeCosts, getCyclicIds, wouldCreateCycle } from "../lib/sub-recipe-costs";
import { generateQrCode } from "../lib/qr-code";
import { kgOrNull } from "@workspace/units";

const router: IRouter = Router();

/** Sanitise a yieldPercent from the request body: a number in (0, 100]
 *  or null (= automatic, yield tracks 100% of component weight). */
function parseYieldPercent(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Recompute and store a sub-recipe's yield from what its components actually
 * weigh. Yields are DERIVED, never free-typed (Graeme's rule, 2026-08-20):
 * the Bun Dough yield went stale after milk was added to the recipe and
 * silently inflated every scaled-up ingredient by 1.5×. Now every save
 * re-derives it — total component weight × (yieldPercent ?? 100)/100 —
 * so the only way a yield differs from the recipe is a deliberate,
 * visible percentage. Units go through @workspace/units (g/ml/kg/l →
 * kg; litres at density 1); count units ("each", "box") are SKIPPED, not
 * absorbed — this used to treat anything unrecognised as kg, which would
 * have made 23 "each" of something weigh 23 kg. Component sub-recipe
 * quantities are already kg (every yield_unit is kg). If the components
 * weigh nothing (data still being typed in), the stored yield is left
 * alone rather than zeroed.
 */
async function recalcSubRecipeYield(subRecipeId: number): Promise<number | null> {
  const ingRows = await db
    .select({ quantity: subRecipeIngredientsTable.quantity, unit: ingredientsTable.unit })
    .from(subRecipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(subRecipeIngredientsTable.subRecipeId, subRecipeId));
  const compRows = await db
    .select({ quantity: subRecipeSubRecipesTable.quantity })
    .from(subRecipeSubRecipesTable)
    .where(eq(subRecipeSubRecipesTable.subRecipeId, subRecipeId));

  const totalKg =
    ingRows.reduce((s, r) => s + (kgOrNull(Number(r.quantity) || 0, r.unit) ?? 0), 0) +
    compRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  if (totalKg <= 0) return null;

  const [row] = await db
    .select({ yieldPercent: subRecipesTable.yieldPercent })
    .from(subRecipesTable)
    .where(eq(subRecipesTable.id, subRecipeId));
  const pct = row?.yieldPercent != null ? Number(row.yieldPercent) : 100;
  const newYield = Math.round(totalKg * (pct / 100) * 10000) / 10000;

  await db.update(subRecipesTable).set({ yield: String(newYield) }).where(eq(subRecipesTable.id, subRecipeId));
  return newYield;
}

router.get("/", async (_req, res) => {
  const rows = await db.select().from(subRecipesTable).orderBy(subRecipesTable.name);
  const [costMap] = await Promise.all([computeSubRecipeCosts()]);
  res.json(rows.map(r => ({
    ...r,
    yield: Number(r.yield),
    yieldPercent: r.yieldPercent != null ? Number(r.yieldPercent) : null,
    createdAt: r.createdAt.toISOString(),
    costPerYieldUnit: costMap[r.id] ?? null,
  })));
});

router.post("/", validate(CreateSubRecipeBody), async (req, res) => {
  const { name, description, yield: yieldAmt, yieldUnit, notes, shelfLifeDays, isBase, expandInPrep, madeOnProductionDay, labelDeclaration, ingredients, subRecipeComponents } = req.body;

  if (subRecipeComponents?.length) {
    const proposedIds = subRecipeComponents.map((c: { componentSubRecipeId: number }) => c.componentSubRecipeId);
    const tempId = -1;
    const hasCycle = await wouldCreateCycle(tempId, proposedIds);
    if (hasCycle) {
      res.status(400).json({ error: "Adding these sub-recipe components would create a circular dependency." });
      return;
    }
  }

  const yieldPercent = parseYieldPercent((req.body as Record<string, unknown>).yieldPercent);
  const [subRecipe] = await db
    .insert(subRecipesTable)
    .values({ name, description, yield: String(yieldAmt), yieldUnit, notes, shelfLifeDays: shelfLifeDays ?? null, isBase: isBase ?? false, expandInPrep: expandInPrep ?? false, madeOnProductionDay: madeOnProductionDay ?? false, yieldPercent: yieldPercent != null ? String(yieldPercent) : null, labelDeclaration: labelDeclaration || null })
    .returning();

  if (ingredients?.length) {
    await db.insert(subRecipeIngredientsTable).values(
      ingredients.map((i: { ingredientId: number; quantity: number; hideFromPrep?: boolean }) => ({
        subRecipeId: subRecipe.id,
        ingredientId: i.ingredientId,
        quantity: String(i.quantity),
        hideFromPrep: i.hideFromPrep ?? false,
      }))
    );
  }

  if (subRecipeComponents?.length) {
    await db.insert(subRecipeSubRecipesTable).values(
      subRecipeComponents.map((c: { componentSubRecipeId: number; quantity: number }) => ({
        subRecipeId: subRecipe.id,
        componentSubRecipeId: c.componentSubRecipeId,
        quantity: String(c.quantity),
      }))
    );
  }

  // The typed yield is only a fallback — the stored value is derived from
  // what the components weigh, so it can never drift from the recipe.
  const derivedYield = await recalcSubRecipeYield(subRecipe.id);

  res.status(201).json({
    ...subRecipe,
    yield: derivedYield ?? Number(subRecipe.yield),
    yieldPercent,
    createdAt: subRecipe.createdAt.toISOString(),
  });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(subRecipesTable).where(eq(subRecipesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const items = await db
    .select({
      id: subRecipeIngredientsTable.id,
      ingredientId: subRecipeIngredientsTable.ingredientId,
      ingredientName: ingredientsTable.name,
      unit: ingredientsTable.unit,
      processingRatio: ingredientsTable.processingRatio,
      quantity: subRecipeIngredientsTable.quantity,
      costPerPack: ingredientsTable.costPerPack,
      packWeight: ingredientsTable.packWeight,
      hideFromPrep: subRecipeIngredientsTable.hideFromPrep,
    })
    .from(subRecipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(subRecipeIngredientsTable.subRecipeId, id));

  const mappedItems = items.map(i => ({
    ...i,
    quantity: Number(i.quantity),
    processingRatio: i.processingRatio != null ? Number(i.processingRatio) : null,
    costPerPack: i.costPerPack != null ? Number(i.costPerPack) : null,
    packWeight: i.packWeight != null ? Number(i.packWeight) : null,
  }));

  const nestedRows = await db
    .select({
      id: subRecipeSubRecipesTable.id,
      componentSubRecipeId: subRecipeSubRecipesTable.componentSubRecipeId,
      componentSubRecipeName: subRecipesTable.name,
      componentYieldUnit: subRecipesTable.yieldUnit,
      quantity: subRecipeSubRecipesTable.quantity,
    })
    .from(subRecipeSubRecipesTable)
    .leftJoin(subRecipesTable, eq(subRecipeSubRecipesTable.componentSubRecipeId, subRecipesTable.id))
    .where(eq(subRecipeSubRecipesTable.subRecipeId, id));

  const [costPerYieldUnitMap, cyclicIds] = await Promise.all([
    computeSubRecipeCosts(),
    getCyclicIds(id),
  ]);

  const mappedNested = nestedRows.map(n => {
    const qty = Number(n.quantity);
    const compCpu = costPerYieldUnitMap[n.componentSubRecipeId!] ?? 0;
    return {
      id: n.id,
      componentSubRecipeId: n.componentSubRecipeId,
      componentSubRecipeName: n.componentSubRecipeName,
      componentYieldUnit: n.componentYieldUnit,
      quantity: qty,
      costPerYieldUnit: compCpu,
      lineCost: qty * compCpu,
    };
  });

  const yieldNum = Number(row.yield);
  const totalBatchCost =
    mappedItems.reduce((sum, i) => {
      if (!i.costPerPack || !i.packWeight || i.packWeight <= 0) return sum;
      return sum + i.quantity * (i.costPerPack / i.packWeight);
    }, 0) + mappedNested.reduce((sum, n) => sum + n.lineCost, 0);

  const costPerYieldUnit = yieldNum > 0 ? totalBatchCost / yieldNum : null;

  res.json({
    ...row,
    yield: yieldNum,
    yieldPercent: row.yieldPercent != null ? Number(row.yieldPercent) : null,
    createdAt: row.createdAt.toISOString(),
    ingredients: mappedItems,
    subRecipeComponents: mappedNested,
    totalBatchCost,
    costPerYieldUnit,
    cyclicIds,
  });
});

router.put("/:id", validate(UpdateSubRecipeBody), async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, yield: yieldAmt, yieldUnit, notes, shelfLifeDays, isBase, expandInPrep, madeOnProductionDay, labelDeclaration, ingredients, subRecipeComponents } = req.body;

  if (subRecipeComponents?.length) {
    const proposedIds = subRecipeComponents.map((c: { componentSubRecipeId: number }) => c.componentSubRecipeId);
    const hasCycle = await wouldCreateCycle(id, proposedIds);
    if (hasCycle) {
      res.status(400).json({ error: "Adding these sub-recipe components would create a circular dependency." });
      return;
    }
  }

  const yieldPercent = parseYieldPercent((req.body as Record<string, unknown>).yieldPercent);
  const [updated] = await db
    .update(subRecipesTable)
    .set({ name, description, yield: String(yieldAmt), yieldUnit, notes, shelfLifeDays: shelfLifeDays ?? null, isBase: isBase ?? false, expandInPrep: expandInPrep ?? false, madeOnProductionDay: madeOnProductionDay ?? false, yieldPercent: yieldPercent != null ? String(yieldPercent) : null, labelDeclaration: labelDeclaration || null })
    .where(eq(subRecipesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(subRecipeIngredientsTable).where(eq(subRecipeIngredientsTable.subRecipeId, id));
  await db.delete(subRecipeSubRecipesTable).where(eq(subRecipeSubRecipesTable.subRecipeId, id));

  if (ingredients?.length) {
    await db.insert(subRecipeIngredientsTable).values(
      ingredients.map((i: { ingredientId: number; quantity: number; hideFromPrep?: boolean }) => ({
        subRecipeId: id,
        ingredientId: i.ingredientId,
        quantity: String(i.quantity),
        hideFromPrep: i.hideFromPrep ?? false,
      }))
    );
  }

  if (subRecipeComponents?.length) {
    await db.insert(subRecipeSubRecipesTable).values(
      subRecipeComponents.map((c: { componentSubRecipeId: number; quantity: number }) => ({
        subRecipeId: id,
        componentSubRecipeId: c.componentSubRecipeId,
        quantity: String(c.quantity),
      }))
    );
  }

  // Re-derive the yield from the ingredient list that was just written —
  // this is the mechanism that stops yields going stale ever again.
  const derivedYield = await recalcSubRecipeYield(id);

  res.json({
    ...updated,
    yield: derivedYield ?? Number(updated.yield),
    yieldPercent,
    createdAt: updated.createdAt.toISOString(),
  });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(subRecipesTable).where(eq(subRecipesTable.id, id));
  res.status(204).send();
});

router.post("/:id/create-kanban", async (req, res) => {
  const id = Number(req.params.id);
  const [subRecipe] = await db.select({ id: subRecipesTable.id, name: subRecipesTable.name }).from(subRecipesTable).where(eq(subRecipesTable.id, id));
  if (!subRecipe) { res.status(404).json({ error: "Sub-recipe not found" }); return; }

  const [existing] = await db.select({ id: kanbanItemsTable.id })
    .from(kanbanItemsTable)
    .where(and(eq(kanbanItemsTable.sourceType, "sub_recipe"), eq(kanbanItemsTable.subRecipeId, id)));
  if (existing) {
    res.status(409).json({ error: "A kanban already exists for this sub-recipe" });
    return;
  }

  try {
    const qrUrl = await generateQrCode("sub_recipe", id);
    const [kanban] = await db.insert(kanbanItemsTable).values({
      sourceType: "sub_recipe",
      subRecipeId: id,
      qrCodeUrl: qrUrl,
      status: "active",
    }).returning();
    res.status(201).json({ kanbanId: kanban.id, qrCodeUrl: qrUrl, subRecipeName: subRecipe.name });
  } catch (err) {
    console.error(`Failed to create kanban for sub-recipe ${id}:`, err);
    res.status(500).json({ error: "Failed to create kanban" });
  }
});

export default router;

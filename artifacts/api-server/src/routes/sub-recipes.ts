import { Router, type IRouter } from "express";
import { db, subRecipesTable, subRecipeIngredientsTable, subRecipeSubRecipesTable, ingredientsTable, kanbanItemsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CreateSubRecipeBody, UpdateSubRecipeBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";
import { computeSubRecipeCosts, getCyclicIds, wouldCreateCycle } from "../lib/sub-recipe-costs";
import { generateQrCode } from "../lib/qr-code";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(subRecipesTable).orderBy(subRecipesTable.name);
  const [costMap] = await Promise.all([computeSubRecipeCosts()]);
  res.json(rows.map(r => ({
    ...r,
    yield: Number(r.yield),
    createdAt: r.createdAt.toISOString(),
    costPerYieldUnit: costMap[r.id] ?? null,
  })));
});

router.post("/", validate(CreateSubRecipeBody), async (req, res) => {
  const { name, description, yield: yieldAmt, yieldUnit, notes, shelfLifeDays, isBase, expandInPrep, labelDeclaration, ingredients, subRecipeComponents } = req.body;

  if (subRecipeComponents?.length) {
    const proposedIds = subRecipeComponents.map((c: { componentSubRecipeId: number }) => c.componentSubRecipeId);
    const tempId = -1;
    const hasCycle = await wouldCreateCycle(tempId, proposedIds);
    if (hasCycle) {
      res.status(400).json({ error: "Adding these sub-recipe components would create a circular dependency." });
      return;
    }
  }

  const [subRecipe] = await db
    .insert(subRecipesTable)
    .values({ name, description, yield: String(yieldAmt), yieldUnit, notes, shelfLifeDays: shelfLifeDays ?? null, isBase: isBase ?? false, expandInPrep: expandInPrep ?? false, labelDeclaration: labelDeclaration || null })
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

  res.status(201).json({ ...subRecipe, yield: Number(subRecipe.yield), createdAt: subRecipe.createdAt.toISOString() });
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
  const { name, description, yield: yieldAmt, yieldUnit, notes, shelfLifeDays, isBase, expandInPrep, labelDeclaration, ingredients, subRecipeComponents } = req.body;

  if (subRecipeComponents?.length) {
    const proposedIds = subRecipeComponents.map((c: { componentSubRecipeId: number }) => c.componentSubRecipeId);
    const hasCycle = await wouldCreateCycle(id, proposedIds);
    if (hasCycle) {
      res.status(400).json({ error: "Adding these sub-recipe components would create a circular dependency." });
      return;
    }
  }

  const [updated] = await db
    .update(subRecipesTable)
    .set({ name, description, yield: String(yieldAmt), yieldUnit, notes, shelfLifeDays: shelfLifeDays ?? null, isBase: isBase ?? false, expandInPrep: expandInPrep ?? false, labelDeclaration: labelDeclaration || null })
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

  res.json({ ...updated, yield: Number(updated.yield), createdAt: updated.createdAt.toISOString() });
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

import { Router, type IRouter } from "express";
import { db, productionPlansTable, productionPlanItemsTable, recipesTable, batchCompletionsTable, stationBreaksTable, recipeIngredientsTable, ingredientsTable } from "@workspace/db";
import { eq, and, desc, sql, gt, asc } from "drizzle-orm";
import { validate } from "../middleware/validate";
import * as z from "zod";

const router: IRouter = Router();

function julianBatchNumber(date: Date): number {
  const year = date.getFullYear() % 100;
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  return year * 1000 + dayOfYear;
}

function mapPlan(p: typeof productionPlansTable.$inferSelect) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
  };
}

function mapItem(i: typeof productionPlanItemsTable.$inferSelect & { recipeName?: string | null; portionsPerBatch?: number | null }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { targetQuantity, actualQuantity, ...rest } = i;
  return {
    ...rest,
    recipeName: i.recipeName ?? "",
    portionsPerBatch: i.portionsPerBatch ?? 10,
  };
}

const CreatePlanBody = z.object({
  planDate: z.string(),
  name: z.string(),
  notes: z.string().nullish(),
  status: z.string().optional(),
  batchNumber: z.number().int().optional(),
  items: z.array(z.object({
    recipeId: z.number(),
    batchesTarget: z.number().int().default(0),
    orderPosition: z.number().int().default(0),
    tinSize: z.string().nullish(),
    maxBatchesPerTin: z.number().int().nullish(),
    sopUrl: z.string().nullish(),
    notes: z.string().nullish(),
  })).optional(),
});

const PLAN_STATUSES = ["draft", "active", "prep", "building", "complete"] as const;
type PlanStatus = typeof PLAN_STATUSES[number];

const UpdatePlanBody = z.object({
  planDate: z.string().optional(),
  name: z.string().optional(),
  notes: z.string().nullish(),
  status: z.enum(PLAN_STATUSES).optional(),
  batchNumber: z.number().int().nullish(),
  items: z.array(z.object({
    recipeId: z.number(),
    batchesTarget: z.number().int().default(0),
    batchesComplete: z.number().int().optional(),
    orderPosition: z.number().int().default(0),
    tinSize: z.string().nullish(),
    maxBatchesPerTin: z.number().int().nullish(),
    sopUrl: z.string().nullish(),
    notes: z.string().nullish(),
    status: z.string().optional(),
  })).optional(),
});

router.get("/", async (req, res) => {
  const { date } = req.query;
  let query = db.select().from(productionPlansTable).$dynamic();
  if (date) {
    query = query.where(eq(productionPlansTable.planDate, String(date)));
  }
  const rows = await query.orderBy(productionPlansTable.planDate);
  res.json(rows.map(mapPlan));
});

router.post("/", validate(CreatePlanBody), async (req, res) => {
  const { planDate, name, notes, status, items } = req.body;
  const dateObj = new Date(planDate);
  const batchNumber = julianBatchNumber(dateObj);

  const [plan] = await db.insert(productionPlansTable).values({
    planDate,
    name,
    notes: notes ?? null,
    status: status ?? "draft",
    batchNumber,
  }).returning();

  if (items?.length) {
    await db.insert(productionPlanItemsTable).values(
      items.map((i: { recipeId: number; batchesTarget?: number; orderPosition?: number; tinSize?: string | null; maxBatchesPerTin?: number | null; sopUrl?: string | null; notes?: string | null }) => ({
        planId: plan.id,
        recipeId: i.recipeId,
        targetQuantity: "0",
        batchesTarget: i.batchesTarget ?? 0,
        orderPosition: i.orderPosition ?? 0,
        tinSize: i.tinSize ?? null,
        maxBatchesPerTin: i.maxBatchesPerTin ?? null,
        sopUrl: i.sopUrl ?? null,
        notes: i.notes ?? null,
        status: "pending",
      }))
    );
  }
  res.status(201).json(mapPlan(plan));
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, id));
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }

  const items = await db
    .select({
      id: productionPlanItemsTable.id,
      planId: productionPlanItemsTable.planId,
      recipeId: productionPlanItemsTable.recipeId,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
      targetQuantity: productionPlanItemsTable.targetQuantity,
      actualQuantity: productionPlanItemsTable.actualQuantity,
      notes: productionPlanItemsTable.notes,
      status: productionPlanItemsTable.status,
      orderPosition: productionPlanItemsTable.orderPosition,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      batchesComplete: productionPlanItemsTable.batchesComplete,
      wonlyCount: productionPlanItemsTable.wonlyCount,
      tinSize: productionPlanItemsTable.tinSize,
      maxBatchesPerTin: productionPlanItemsTable.maxBatchesPerTin,
      sopUrl: productionPlanItemsTable.sopUrl,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, id))
    .orderBy(productionPlanItemsTable.orderPosition);

  res.json({ ...mapPlan(plan), items: items.map(mapItem) });
});

router.put("/:id", validate(UpdatePlanBody), async (req, res) => {
  const id = Number(req.params.id);
  const { planDate, name, notes, status, items } = req.body;

  const updateData: Record<string, unknown> = {};
  if (planDate !== undefined) updateData.planDate = planDate;
  if (name !== undefined) updateData.name = name;
  if (notes !== undefined) updateData.notes = notes ?? null;
  if (status !== undefined) updateData.status = status;

  const [updated] = await db.update(productionPlansTable)
    .set(updateData as Parameters<typeof db.update>[0])
    .where(eq(productionPlansTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  if (items !== undefined) {
    await db.delete(productionPlanItemsTable).where(eq(productionPlanItemsTable.planId, id));
    if (items.length) {
      await db.insert(productionPlanItemsTable).values(
        items.map((i: {
          recipeId: number;
          batchesTarget?: number;
          batchesComplete?: number;
          orderPosition?: number;
          tinSize?: string | null;
          maxBatchesPerTin?: number | null;
          sopUrl?: string | null;
          notes?: string | null;
          status?: string;
        }) => ({
          planId: id,
          recipeId: i.recipeId,
          targetQuantity: "0",
          batchesTarget: i.batchesTarget ?? 0,
          batchesComplete: i.batchesComplete ?? 0,
          orderPosition: i.orderPosition ?? 0,
          tinSize: i.tinSize ?? null,
          maxBatchesPerTin: i.maxBatchesPerTin ?? null,
          sopUrl: i.sopUrl ?? null,
          notes: i.notes ?? null,
          status: i.status ?? "pending",
        }))
      );
    }
  }
  res.json(mapPlan(updated));
});

// PATCH order for a specific plan — updates orderPosition of all items atomically
router.patch("/:id/order", async (req, res) => {
  const id = Number(req.params.id);
  const { order } = req.body as { order: { itemId: number; orderPosition: number }[] };
  if (!Array.isArray(order)) { res.status(400).json({ error: "order must be an array" }); return; }

  const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, id));
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }

  for (const { itemId, orderPosition } of order) {
    await db.update(productionPlanItemsTable)
      .set({ orderPosition })
      .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, id)));
  }

  res.json({ ok: true });
});

// PATCH a single plan item's batchesComplete
router.patch("/:id/items/:itemId", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { batchesComplete, status, wonlyCount } = req.body;

  const updateData: Record<string, unknown> = {};
  if (batchesComplete !== undefined) updateData.batchesComplete = batchesComplete;
  if (status !== undefined) updateData.status = status;
  if (wonlyCount !== undefined) updateData.wonlyCount = wonlyCount;

  const [updated] = await db.update(productionPlanItemsTable)
    .set(updateData as Parameters<typeof db.update>[0])
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapItem(updated));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(productionPlansTable).where(eq(productionPlansTable.id, id));
  res.status(204).send();
});

// Batch completions sub-routes
router.post("/:id/batch-completions", async (req, res) => {
  const planId = Number(req.params.id);
  const { planItemId, stationType, userId, startedAt, completedAt } = req.body;

  const [row] = await db.insert(batchCompletionsTable).values({
    planItemId,
    stationType,
    userId: userId ?? null,
    startedAt: startedAt ? new Date(startedAt) : null,
    completedAt: completedAt ? new Date(completedAt) : new Date(),
  }).returning();

  // Increment batchesComplete on the item
  await db.execute(
    sql`UPDATE production_plan_items SET batches_complete = batches_complete + 1, status = CASE WHEN batches_complete + 1 >= batches_target THEN 'completed' ELSE 'in_progress' END WHERE id = ${planItemId}`
  );

  res.status(201).json(row);
});

router.get("/:id/batch-completions", async (req, res) => {
  const planId = Number(req.params.id);
  const { stationType } = req.query;

  const items = await db.select({ id: productionPlanItemsTable.id })
    .from(productionPlanItemsTable)
    .where(eq(productionPlanItemsTable.planId, planId));

  const itemIds = items.map(i => i.id);
  if (itemIds.length === 0) { res.json([]); return; }

  let completions = await db.select().from(batchCompletionsTable)
    .where(sql`plan_item_id = ANY(${itemIds})`)
    .orderBy(desc(batchCompletionsTable.completedAt));

  if (stationType) {
    completions = completions.filter(c => c.stationType === stationType);
  }

  res.json(completions.map(c => ({ ...c, completedAt: c.completedAt.toISOString(), startedAt: c.startedAt ? c.startedAt.toISOString() : null })));
});

// Station breaks sub-routes
router.post("/:id/station-breaks", async (req, res) => {
  const planId = Number(req.params.id);
  const { stationType, userId, breakType, startedAt } = req.body;

  const [row] = await db.insert(stationBreaksTable).values({
    planId,
    stationType,
    userId: userId ?? null,
    breakType: breakType ?? "morning",
    startedAt: startedAt ? new Date(startedAt) : new Date(),
  }).returning();

  res.status(201).json({ ...row, startedAt: row.startedAt.toISOString(), endedAt: null });
});

router.patch("/:id/station-breaks/:breakId", async (req, res) => {
  const breakId = Number(req.params.breakId);
  const { endedAt } = req.body;

  const [updated] = await db.update(stationBreaksTable)
    .set({ endedAt: endedAt ? new Date(endedAt) : new Date() })
    .where(eq(stationBreaksTable.id, breakId))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...updated, startedAt: updated.startedAt.toISOString(), endedAt: updated.endedAt ? updated.endedAt.toISOString() : null });
});

router.get("/:id/station-breaks", async (req, res) => {
  const planId = Number(req.params.id);
  const rows = await db.select().from(stationBreaksTable).where(eq(stationBreaksTable.planId, planId));
  res.json(rows.map(r => ({ ...r, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt ? r.endedAt.toISOString() : null })));
});

// GET /:id/prep-requirements?station=prep_veg|prep_bases|prep_meat|all
router.get("/:id/prep-requirements", async (req, res) => {
  const planId = Number(req.params.id);
  const station = String(req.query.station ?? "all");

  const planItems = await db
    .select({
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  if (planItems.length === 0) {
    res.json({ items: [], nextPlanDate: null });
    return;
  }

  const recipeIds = planItems.map(p => p.recipeId).filter(Boolean) as number[];

  const allIngredientRows: {
    recipeId: number;
    ingredientId: number;
    quantityPerBatch: string;
    ingredientName: string | null;
    unit: string | null;
    category: string | null;
    processingRatio: string | null;
    rawMeatTrayCapacityKg: string | null;
  }[] = [];

  for (const rid of recipeIds) {
    const rows = await db
      .select({
        recipeId: recipeIngredientsTable.recipeId,
        ingredientId: recipeIngredientsTable.ingredientId,
        quantityPerBatch: recipeIngredientsTable.quantity,
        ingredientName: ingredientsTable.name,
        unit: ingredientsTable.unit,
        category: ingredientsTable.category,
        processingRatio: ingredientsTable.processingRatio,
        rawMeatTrayCapacityKg: ingredientsTable.rawMeatTrayCapacityKg,
      })
      .from(recipeIngredientsTable)
      .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(eq(recipeIngredientsTable.recipeId, rid));
    allIngredientRows.push(...rows);
  }

  const aggregated: Record<number, {
    ingredientId: number;
    ingredientName: string;
    unit: string;
    category: string | null;
    processingRatio: number | null;
    rawMeatTrayCapacityKg: number | null;
    totalCookedQty: number;
    totalRawQty: number;
    trayCount: number | null;
    recipes: string[];
  }> = {};

  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    const itemIngredients = allIngredientRows.filter(i => i.recipeId === planItem.recipeId);

    for (const ing of itemIngredients) {
      if (!ing.ingredientId) continue;
      const iid = ing.ingredientId;
      const qtyPerBatch = Number(ing.quantityPerBatch) || 0;
      const totalCookedQty = qtyPerBatch * batchesTarget;
      const processingRatio = ing.processingRatio ? Number(ing.processingRatio) : null;
      const totalRawQty = processingRatio ? totalCookedQty / processingRatio : totalCookedQty;

      if (!aggregated[iid]) {
        aggregated[iid] = {
          ingredientId: iid,
          ingredientName: ing.ingredientName ?? `Ingredient #${iid}`,
          unit: ing.unit ?? "g",
          category: ing.category ?? null,
          processingRatio,
          rawMeatTrayCapacityKg: ing.rawMeatTrayCapacityKg ? Number(ing.rawMeatTrayCapacityKg) : null,
          totalCookedQty: 0,
          totalRawQty: 0,
          trayCount: null,
          recipes: [],
        };
      }

      aggregated[iid].totalCookedQty += totalCookedQty;
      aggregated[iid].totalRawQty += totalRawQty;
      if (planItem.recipeName && !aggregated[iid].recipes.includes(planItem.recipeName)) {
        aggregated[iid].recipes.push(planItem.recipeName);
      }
    }
  }

  for (const item of Object.values(aggregated)) {
    if (item.rawMeatTrayCapacityKg && item.totalRawQty > 0) {
      const totalRawKg = item.totalRawQty / 1000;
      item.trayCount = Math.ceil(totalRawKg / item.rawMeatTrayCapacityKg);
    }
  }

  let items = Object.values(aggregated);
  if (station === "prep_meat") {
    items = items.filter(i => i.category === "raw_meat" || i.rawMeatTrayCapacityKg != null);
  } else if (station === "prep_veg") {
    items = items.filter(i => i.category === "vegetable");
  } else if (station === "prep_bases") {
    items = items.filter(i => ["base", "sauce", "cheese"].includes(i.category ?? ""));
  }

  const plan = await db.select({ planDate: productionPlansTable.planDate }).from(productionPlansTable).where(eq(productionPlansTable.id, planId)).limit(1);
  let nextPlanDate: string | null = null;
  if (plan.length > 0) {
    const nextPlans = await db
      .select({ planDate: productionPlansTable.planDate, id: productionPlansTable.id })
      .from(productionPlansTable)
      .where(gt(productionPlansTable.planDate, plan[0].planDate))
      .orderBy(asc(productionPlansTable.planDate))
      .limit(1);
    nextPlanDate = nextPlans[0]?.planDate ?? null;
  }

  res.json({ items, nextPlanDate });
});

export default router;

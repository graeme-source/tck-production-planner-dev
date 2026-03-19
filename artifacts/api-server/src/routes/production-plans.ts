import { Router, type IRouter } from "express";
import { db, productionPlansTable, productionPlanItemsTable, recipesTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { CreateProductionPlanBody, UpdateProductionPlanBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

function mapPlan(p: typeof productionPlansTable.$inferSelect) {
  return { ...p, createdAt: p.createdAt.toISOString() };
}

function mapItem(i: typeof productionPlanItemsTable.$inferSelect & { recipeName?: string | null }) {
  return {
    ...i,
    targetQuantity: Number(i.targetQuantity),
    actualQuantity: i.actualQuantity != null ? Number(i.actualQuantity) : null,
    recipeName: i.recipeName ?? "",
  };
}

router.get("/", async (req, res) => {
  const { date } = req.query;
  let query = db.select().from(productionPlansTable).$dynamic();
  if (date) {
    query = query.where(eq(productionPlansTable.planDate, String(date)));
  }
  const rows = await query.orderBy(productionPlansTable.planDate);
  res.json(rows.map(mapPlan));
});

router.post("/", validate(CreateProductionPlanBody), async (req, res) => {
  const { planDate, name, notes, items } = req.body;
  const [plan] = await db.insert(productionPlansTable).values({ planDate, name, notes, status: "draft" }).returning();
  if (items?.length) {
    await db.insert(productionPlanItemsTable).values(
      items.map((i: { recipeId: number; targetQuantity: number; notes?: string }) => ({
        planId: plan.id,
        recipeId: i.recipeId,
        targetQuantity: String(i.targetQuantity),
        notes: i.notes,
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
      recipeId: productionPlanItemsTable.recipeId,
      recipeName: recipesTable.name,
      targetQuantity: productionPlanItemsTable.targetQuantity,
      actualQuantity: productionPlanItemsTable.actualQuantity,
      notes: productionPlanItemsTable.notes,
      status: productionPlanItemsTable.status,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, id));
  res.json({ ...mapPlan(plan), items: items.map(mapItem) });
});

router.put("/:id", validate(UpdateProductionPlanBody), async (req, res) => {
  const id = Number(req.params.id);
  const { planDate, name, notes, status, items } = req.body;
  const [updated] = await db.update(productionPlansTable).set({ planDate, name, notes, status }).where(eq(productionPlansTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  if (items) {
    await db.delete(productionPlanItemsTable).where(eq(productionPlanItemsTable.planId, id));
    if (items.length) {
      await db.insert(productionPlanItemsTable).values(
        items.map((i: { recipeId: number; targetQuantity: number; actualQuantity?: number; notes?: string; status: string }) => ({
          planId: id,
          recipeId: i.recipeId,
          targetQuantity: String(i.targetQuantity),
          actualQuantity: i.actualQuantity != null ? String(i.actualQuantity) : null,
          notes: i.notes,
          status: i.status ?? "pending",
        }))
      );
    }
  }
  res.json(mapPlan(updated));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(productionPlansTable).where(eq(productionPlansTable.id, id));
  res.status(204).send();
});

export default router;

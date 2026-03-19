import { Router, type IRouter } from "express";
import { db, dispatchOrdersTable, recipesTable } from "@workspace/db";
import { eq, gte, lte, and } from "drizzle-orm";
import { CreateDispatchOrderBody, UpdateDispatchOrderBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  const { startDate, endDate } = req.query;
  const conditions = [];
  if (startDate) conditions.push(gte(dispatchOrdersTable.dispatchDate, String(startDate)));
  if (endDate) conditions.push(lte(dispatchOrdersTable.dispatchDate, String(endDate)));

  const rows = await db
    .select({
      id: dispatchOrdersTable.id,
      recipeId: dispatchOrdersTable.recipeId,
      recipeName: recipesTable.name,
      dispatchDate: dispatchOrdersTable.dispatchDate,
      quantity: dispatchOrdersTable.quantity,
      customer: dispatchOrdersTable.customer,
      status: dispatchOrdersTable.status,
      notes: dispatchOrdersTable.notes,
      createdAt: dispatchOrdersTable.createdAt,
    })
    .from(dispatchOrdersTable)
    .leftJoin(recipesTable, eq(dispatchOrdersTable.recipeId, recipesTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(dispatchOrdersTable.dispatchDate);
  res.json(rows.map(r => ({ ...r, quantity: Number(r.quantity), createdAt: r.createdAt.toISOString(), recipeName: r.recipeName ?? "" })));
});

router.post("/", validate(CreateDispatchOrderBody), async (req, res) => {
  const { recipeId, dispatchDate, quantity, customer, status, notes } = req.body;
  const [row] = await db.insert(dispatchOrdersTable).values({ recipeId, dispatchDate, quantity: String(quantity), customer, status: status ?? "pending", notes }).returning();
  res.status(201).json({ ...row, quantity: Number(row.quantity), createdAt: row.createdAt.toISOString() });
});

router.put("/:id", validate(UpdateDispatchOrderBody), async (req, res) => {
  const id = Number(req.params.id);
  const { recipeId, dispatchDate, quantity, customer, status, notes } = req.body;
  const [row] = await db.update(dispatchOrdersTable).set({ recipeId, dispatchDate, quantity: String(quantity), customer, status, notes }).where(eq(dispatchOrdersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, quantity: Number(row.quantity), createdAt: row.createdAt.toISOString() });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(dispatchOrdersTable).where(eq(dispatchOrdersTable.id, id));
  res.status(204).send();
});

export default router;

import { Router, type IRouter } from "express";
import { db, stockEntriesTable, recipesTable, ingredientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateStockEntryBody, UpdateStockEntryBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const rows = await db
    .select({
      id: stockEntriesTable.id,
      recipeId: stockEntriesTable.recipeId,
      recipeName: recipesTable.name,
      ingredientId: stockEntriesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      itemType: stockEntriesTable.itemType,
      quantity: stockEntriesTable.quantity,
      unit: stockEntriesTable.unit,
      checkedAt: stockEntriesTable.checkedAt,
      notes: stockEntriesTable.notes,
    })
    .from(stockEntriesTable)
    .leftJoin(recipesTable, eq(stockEntriesTable.recipeId, recipesTable.id))
    .leftJoin(ingredientsTable, eq(stockEntriesTable.ingredientId, ingredientsTable.id))
    .orderBy(stockEntriesTable.checkedAt);
  res.json(rows.map(r => ({ ...r, quantity: Number(r.quantity), checkedAt: r.checkedAt.toISOString() })));
});

router.post("/", validate(CreateStockEntryBody), async (req, res) => {
  const { recipeId, ingredientId, itemType, quantity, unit, notes } = req.body;
  const [row] = await db.insert(stockEntriesTable).values({
    recipeId: recipeId ?? null,
    ingredientId: ingredientId ?? null,
    itemType,
    quantity: String(quantity),
    unit,
    notes,
  }).returning();
  res.status(201).json({ ...row, quantity: Number(row.quantity), checkedAt: row.checkedAt.toISOString() });
});

router.put("/:id", validate(UpdateStockEntryBody), async (req, res) => {
  const id = Number(req.params.id);
  const { recipeId, ingredientId, itemType, quantity, unit, notes } = req.body;
  const [row] = await db.update(stockEntriesTable).set({
    recipeId: recipeId ?? null,
    ingredientId: ingredientId ?? null,
    itemType,
    quantity: String(quantity),
    unit,
    notes,
  }).where(eq(stockEntriesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, quantity: Number(row.quantity), checkedAt: row.checkedAt.toISOString() });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, id));
  res.status(204).send();
});

export default router;

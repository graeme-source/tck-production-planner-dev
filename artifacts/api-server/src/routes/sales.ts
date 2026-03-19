import { Router, type IRouter } from "express";
import { db, salesEntriesTable, recipesTable } from "@workspace/db";
import { eq, gte, lte, and } from "drizzle-orm";
import { CreateSalesEntryBody, UpdateSalesEntryBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  const { startDate, endDate } = req.query;
  const conditions = [];
  if (startDate) conditions.push(gte(salesEntriesTable.saleDate, String(startDate)));
  if (endDate) conditions.push(lte(salesEntriesTable.saleDate, String(endDate)));

  const rows = await db
    .select({
      id: salesEntriesTable.id,
      recipeId: salesEntriesTable.recipeId,
      recipeName: recipesTable.name,
      saleDate: salesEntriesTable.saleDate,
      quantitySold: salesEntriesTable.quantitySold,
      channel: salesEntriesTable.channel,
      notes: salesEntriesTable.notes,
      createdAt: salesEntriesTable.createdAt,
    })
    .from(salesEntriesTable)
    .leftJoin(recipesTable, eq(salesEntriesTable.recipeId, recipesTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(salesEntriesTable.saleDate);
  res.json(rows.map(r => ({ ...r, quantitySold: Number(r.quantitySold), createdAt: r.createdAt.toISOString(), recipeName: r.recipeName ?? "" })));
});

router.post("/", validate(CreateSalesEntryBody), async (req, res) => {
  const { recipeId, saleDate, quantitySold, channel, notes } = req.body;
  const [row] = await db.insert(salesEntriesTable).values({ recipeId, saleDate, quantitySold: String(quantitySold), channel, notes }).returning();
  res.status(201).json({ ...row, quantitySold: Number(row.quantitySold), createdAt: row.createdAt.toISOString() });
});

router.put("/:id", validate(UpdateSalesEntryBody), async (req, res) => {
  const id = Number(req.params.id);
  const { recipeId, saleDate, quantitySold, channel, notes } = req.body;
  const [row] = await db.update(salesEntriesTable).set({ recipeId, saleDate, quantitySold: String(quantitySold), channel, notes }).where(eq(salesEntriesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, quantitySold: Number(row.quantitySold), createdAt: row.createdAt.toISOString() });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(salesEntriesTable).where(eq(salesEntriesTable.id, id));
  res.status(204).send();
});

export default router;

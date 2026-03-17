import { Router, type IRouter } from "express";
import { db, ingredientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(ingredientsTable).orderBy(ingredientsTable.name);
  res.json(rows.map(r => ({
    ...r,
    costPerUnit: Number(r.costPerUnit),
    createdAt: r.createdAt.toISOString(),
  })));
});

router.post("/", async (req, res) => {
  const { name, unit, costPerUnit, notes } = req.body;
  const [row] = await db.insert(ingredientsTable).values({ name, unit, costPerUnit: String(costPerUnit), notes }).returning();
  res.status(201).json({ ...row, costPerUnit: Number(row.costPerUnit), createdAt: row.createdAt.toISOString() });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, costPerUnit: Number(row.costPerUnit), createdAt: row.createdAt.toISOString() });
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, unit, costPerUnit, notes } = req.body;
  const [row] = await db.update(ingredientsTable).set({ name, unit, costPerUnit: String(costPerUnit), notes }).where(eq(ingredientsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, costPerUnit: Number(row.costPerUnit), createdAt: row.createdAt.toISOString() });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(ingredientsTable).where(eq(ingredientsTable.id, id));
  res.status(204).send();
});

export default router;

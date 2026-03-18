import { Router, type IRouter } from "express";
import { db, categoryDefaultsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const mapRow = (r: typeof categoryDefaultsTable.$inferSelect) => ({
  ...r,
  defaultPackagingCost: Number(r.defaultPackagingCost),
  defaultLabourCost: Number(r.defaultLabourCost),
  createdAt: r.createdAt.toISOString(),
});

router.get("/", async (_req, res) => {
  const rows = await db.select().from(categoryDefaultsTable).orderBy(categoryDefaultsTable.category);
  res.json(rows.map(mapRow));
});

router.post("/", async (req, res) => {
  const { category, defaultPackagingCost, defaultLabourCost } = req.body;
  const [row] = await db.insert(categoryDefaultsTable)
    .values({ category, defaultPackagingCost: String(defaultPackagingCost ?? 0), defaultLabourCost: String(defaultLabourCost ?? 0) })
    .returning();
  res.status(201).json(mapRow(row));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { category, defaultPackagingCost, defaultLabourCost } = req.body;
  const [row] = await db.update(categoryDefaultsTable)
    .set({ category, defaultPackagingCost: String(defaultPackagingCost ?? 0), defaultLabourCost: String(defaultLabourCost ?? 0) })
    .where(eq(categoryDefaultsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(categoryDefaultsTable).where(eq(categoryDefaultsTable.id, id));
  res.status(204).send();
});

export default router;

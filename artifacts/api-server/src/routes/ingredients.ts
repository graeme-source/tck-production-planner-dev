import { Router, type IRouter } from "express";
import { db, ingredientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

function mapRow(r: typeof ingredientsTable.$inferSelect) {
  return {
    ...r,
    packWeight: Number(r.packWeight),
    costPerPack: Number(r.costPerPack),
    processingRatio: r.processingRatio !== null && r.processingRatio !== undefined ? Number(r.processingRatio) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/", async (_req, res) => {
  const rows = await db.select().from(ingredientsTable).orderBy(ingredientsTable.name);
  res.json(rows.map(mapRow));
});

function validateProcessingRatio(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (isNaN(n) || n < 0 || n > 1) return "processingRatio must be a number between 0 and 1";
  return null;
}

router.post("/", async (req, res) => {
  const { name, unit, packWeight, costPerPack, brand, supplierPartNumber, supplierId, secondarySupplierId, orderingUrl, notes, processingRatio } = req.body;
  const ratioError = validateProcessingRatio(processingRatio);
  if (ratioError) { res.status(400).json({ error: ratioError }); return; }
  const [row] = await db.insert(ingredientsTable).values({
    name,
    unit,
    packWeight: String(packWeight ?? 0),
    costPerPack: String(costPerPack ?? 0),
    brand: brand || null,
    supplierPartNumber: supplierPartNumber || null,
    supplierId: supplierId ? Number(supplierId) : null,
    secondarySupplierId: secondarySupplierId ? Number(secondarySupplierId) : null,
    orderingUrl: orderingUrl || null,
    notes: notes || null,
    processingRatio: processingRatio !== null && processingRatio !== undefined ? String(processingRatio) : null,
  }).returning();
  res.status(201).json(mapRow(row));
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, unit, packWeight, costPerPack, brand, supplierPartNumber, supplierId, secondarySupplierId, orderingUrl, notes, processingRatio } = req.body;
  const ratioError = validateProcessingRatio(processingRatio);
  if (ratioError) { res.status(400).json({ error: ratioError }); return; }
  const [row] = await db.update(ingredientsTable).set({
    name,
    unit,
    packWeight: String(packWeight ?? 0),
    costPerPack: String(costPerPack ?? 0),
    brand: brand || null,
    supplierPartNumber: supplierPartNumber || null,
    supplierId: supplierId ? Number(supplierId) : null,
    secondarySupplierId: secondarySupplierId ? Number(secondarySupplierId) : null,
    orderingUrl: orderingUrl || null,
    notes: notes || null,
    processingRatio: processingRatio !== null && processingRatio !== undefined ? String(processingRatio) : null,
  }).where(eq(ingredientsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(ingredientsTable).where(eq(ingredientsTable.id, id));
  res.status(204).send();
});

export default router;

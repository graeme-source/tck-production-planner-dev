import { Router, type IRouter } from "express";
import { db, stockItemsTable, suppliersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CreateStockItemBody, UpdateStockItemBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

function mapRow(r: typeof stockItemsTable.$inferSelect) {
  return {
    ...r,
    packWeight: Number(r.packWeight),
    costPerPack: Number(r.costPerPack),
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/categories/list", async (_req, res) => {
  const rows = await db.execute(sql`SELECT id, name, created_at FROM stock_item_categories ORDER BY name`);
  res.json(rows.rows);
});

router.post("/categories", async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
  try {
    const result = await db.execute(sql`INSERT INTO stock_item_categories (name) VALUES (${name.trim()}) RETURNING id, name, created_at`);
    res.status(201).json(result.rows[0]);
  } catch (e: any) {
    if (e.code === "23505") { res.status(409).json({ error: "Category already exists" }); return; }
    throw e;
  }
});

router.put("/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
  try {
    const result = await db.execute(sql`UPDATE stock_item_categories SET name = ${name.trim()} WHERE id = ${id} RETURNING id, name, created_at`);
    if (result.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result.rows[0]);
  } catch (e: any) {
    if (e.code === "23505") { res.status(409).json({ error: "Category already exists" }); return; }
    throw e;
  }
});

router.delete("/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.execute(sql`DELETE FROM stock_item_categories WHERE id = ${id}`);
  res.status(204).send();
});

router.get("/", async (req, res) => {
  const { category } = req.query;
  if (category && typeof category === "string") {
    const rows = await db.select().from(stockItemsTable).where(eq(stockItemsTable.category, category)).orderBy(stockItemsTable.name);
    res.json(rows.map(mapRow));
    return;
  }
  const rows = await db.select().from(stockItemsTable).orderBy(stockItemsTable.name);
  res.json(rows.map(mapRow));
});

router.post("/", validate(CreateStockItemBody), async (req, res) => {
  const { name, category, unit, packWeight, costPerPack, supplierId, secondarySupplierId, supplierPartNumber, orderingUrl, stockCheckEnabled, stockCheckFrequency, stockCheckDay, notes } = req.body;
  const [row] = await db.insert(stockItemsTable).values({
    name,
    category,
    unit,
    packWeight: String(packWeight ?? 0),
    costPerPack: String(costPerPack ?? 0),
    supplierId: supplierId ? Number(supplierId) : null,
    secondarySupplierId: secondarySupplierId ? Number(secondarySupplierId) : null,
    supplierPartNumber: supplierPartNumber || null,
    orderingUrl: orderingUrl || null,
    stockCheckEnabled: stockCheckEnabled ?? false,
    stockCheckFrequency: stockCheckFrequency ?? "daily",
    stockCheckDay: stockCheckDay || null,
    notes: notes || null,
  }).returning();
  res.status(201).json(mapRow(row));
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(stockItemsTable).where(eq(stockItemsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.put("/:id", validate(UpdateStockItemBody), async (req, res) => {
  const id = Number(req.params.id);
  const { name, category, unit, packWeight, costPerPack, supplierId, secondarySupplierId, supplierPartNumber, orderingUrl, stockCheckEnabled, stockCheckFrequency, stockCheckDay, notes } = req.body;
  const [row] = await db.update(stockItemsTable).set({
    name,
    category,
    unit,
    packWeight: String(packWeight ?? 0),
    costPerPack: String(costPerPack ?? 0),
    supplierId: supplierId ? Number(supplierId) : null,
    secondarySupplierId: secondarySupplierId ? Number(secondarySupplierId) : null,
    supplierPartNumber: supplierPartNumber || null,
    orderingUrl: orderingUrl || null,
    ...(stockCheckEnabled !== undefined ? { stockCheckEnabled } : {}),
    ...(stockCheckFrequency !== undefined ? { stockCheckFrequency } : {}),
    stockCheckDay: stockCheckDay || null,
    notes: notes || null,
  }).where(eq(stockItemsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(stockItemsTable).where(eq(stockItemsTable.id, id));
  res.status(204).send();
});

export default router;

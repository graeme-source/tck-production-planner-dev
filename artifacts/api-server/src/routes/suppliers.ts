import { Router, type IRouter } from "express";
import { db, suppliersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateSupplierBody, UpdateSupplierBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

function mapRow(r: typeof suppliersTable.$inferSelect) {
  return { ...r, createdAt: r.createdAt.toISOString() };
}

router.get("/", async (_req, res) => {
  const rows = await db.select().from(suppliersTable).orderBy(suppliersTable.name);
  res.json(rows.map(mapRow));
});

router.post("/", validate(CreateSupplierBody), async (req, res) => {
  const { name, contactName, email, phone, website, address, notes } = req.body;
  const [row] = await db.insert(suppliersTable).values({ name, contactName, email, phone, website, address, notes }).returning();
  res.status(201).json(mapRow(row));
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.put("/:id", validate(UpdateSupplierBody), async (req, res) => {
  const id = Number(req.params.id);
  const { name, contactName, email, phone, website, address, notes } = req.body;
  const [row] = await db.update(suppliersTable).set({ name, contactName, email, phone, website, address, notes }).where(eq(suppliersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(suppliersTable).where(eq(suppliersTable.id, id));
  res.status(204).send();
});

export default router;

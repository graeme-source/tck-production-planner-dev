import { Router, type IRouter } from "express";
import { db, temperatureRecordsTable, usersTable } from "@workspace/db";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import * as z from "zod";
import { londonEndOfDay } from "../lib/london-time";

const router: IRouter = Router();

const insertSchema = z.object({
  planId: z.number().int(),
  planName: z.string().optional(),
  recipeId: z.number().int().optional(),
  recipeName: z.string().optional(),
  ingredientId: z.number().int().optional(),
  ingredientName: z.string().optional(),
  trayIndex: z.number().int().min(0),
  temperatureC: z.number().min(-50).max(500),
  recordType: z.string().default("cooked_core"),
});

router.post("/", async (req, res) => {
  const userId = req.session?.userId ?? null;
  let userName: string | null = null;
  if (userId) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    userName = u?.name ?? null;
  }

  const parsed = insertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", issues: parsed.error.issues });
    return;
  }

  const d = parsed.data;
  const [record] = await db.insert(temperatureRecordsTable).values({
    planId: d.planId,
    planName: d.planName ?? null,
    recipeId: d.recipeId ?? null,
    recipeName: d.recipeName ?? null,
    ingredientId: d.ingredientId ?? null,
    ingredientName: d.ingredientName ?? null,
    trayIndex: d.trayIndex,
    temperatureC: String(d.temperatureC),
    recordType: d.recordType,
    userId,
    userName,
  }).returning();

  res.json(record);
});

// Edit an existing temperature record (operators correcting a wrong reading
// or a wrong timestamp from the cooking summary table in mix-prep).
const editSchema = z.object({
  temperatureC: z.number().min(-50).max(500).optional(),
  recordedAt: z.string().datetime().optional(),
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", issues: parsed.error.issues });
    return;
  }
  const updates: { temperatureC?: string; recordedAt?: Date } = {};
  if (parsed.data.temperatureC !== undefined) updates.temperatureC = String(parsed.data.temperatureC);
  if (parsed.data.recordedAt) updates.recordedAt = new Date(parsed.data.recordedAt);
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No changes supplied" });
    return;
  }
  const [updated] = await db.update(temperatureRecordsTable)
    .set(updates)
    .where(eq(temperatureRecordsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Temperature record not found" });
    return;
  }
  res.json(updated);
});

router.get("/", async (req, res) => {
  const { from, to, planId } = req.query;

  const conditions = [];
  if (planId) conditions.push(eq(temperatureRecordsTable.planId, Number(planId)));
  if (from) conditions.push(gte(temperatureRecordsTable.recordedAt, new Date(String(from))));
  if (to) {
    conditions.push(lte(temperatureRecordsTable.recordedAt, londonEndOfDay(new Date(String(to)))));
  }

  const rows = await db
    .select()
    .from(temperatureRecordsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(temperatureRecordsTable.recordedAt))
    .limit(500);

  res.json(rows);
});

export default router;

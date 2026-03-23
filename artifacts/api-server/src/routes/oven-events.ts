import { Router, type IRouter } from "express";
import { db, ovenEventsTable, usersTable } from "@workspace/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import * as z from "zod";

const router: IRouter = Router();

const ovenInSchema = z.object({
  planId: z.number().int(),
  recipeId: z.number().int().optional(),
  recipeName: z.string().optional(),
  ingredientId: z.number().int().optional(),
  ingredientName: z.string().optional(),
  trayIndex: z.number().int().min(0),
});

router.post("/oven-in", async (req, res) => {
  const userId = req.session?.userId ?? null;
  let userName: string | null = null;
  if (userId) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    userName = u?.name ?? null;
  }

  const parsed = ovenInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", issues: parsed.error.issues });
    return;
  }

  const d = parsed.data;
  const [record] = await db.insert(ovenEventsTable).values({
    planId: d.planId,
    recipeId: d.recipeId ?? null,
    recipeName: d.recipeName ?? null,
    ingredientId: d.ingredientId ?? null,
    ingredientName: d.ingredientName ?? null,
    trayIndex: d.trayIndex,
    userId,
    userName,
  }).returning();

  res.json(record);
});

const ovenOutSchema = z.object({
  planId: z.number().int(),
  recipeId: z.number().int().optional(),
  ingredientId: z.number().int().optional(),
  trayIndex: z.number().int().min(0),
});

router.post("/oven-out", async (req, res) => {
  const parsed = ovenOutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", issues: parsed.error.issues });
    return;
  }

  const d = parsed.data;
  const conditions = [
    eq(ovenEventsTable.planId, d.planId),
    eq(ovenEventsTable.trayIndex, d.trayIndex),
    isNull(ovenEventsTable.ovenOutAt),
  ];
  if (d.recipeId != null) conditions.push(eq(ovenEventsTable.recipeId, d.recipeId));
  if (d.ingredientId != null) conditions.push(eq(ovenEventsTable.ingredientId, d.ingredientId));

  const [updated] = await db.update(ovenEventsTable)
    .set({ ovenOutAt: new Date() })
    .where(and(...conditions))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "No matching oven-in event found" });
    return;
  }

  res.json(updated);
});

router.delete("/", async (req, res) => {
  const { planId, recipeId, ingredientId, trayIndex } = req.query;
  if (!planId || trayIndex === undefined) {
    res.status(400).json({ error: "planId and trayIndex are required" });
    return;
  }

  const conditions = [
    eq(ovenEventsTable.planId, Number(planId)),
    eq(ovenEventsTable.trayIndex, Number(trayIndex)),
  ];
  if (recipeId) conditions.push(eq(ovenEventsTable.recipeId, Number(recipeId)));
  if (ingredientId) conditions.push(eq(ovenEventsTable.ingredientId, Number(ingredientId)));

  await db.delete(ovenEventsTable).where(and(...conditions));
  res.json({ ok: true });
});

router.get("/", async (req, res) => {
  const { planId } = req.query;
  if (!planId) {
    res.status(400).json({ error: "planId is required" });
    return;
  }

  const rows = await db
    .select()
    .from(ovenEventsTable)
    .where(eq(ovenEventsTable.planId, Number(planId)))
    .orderBy(desc(ovenEventsTable.ovenInAt));

  res.json(rows);
});

export default router;

import { Router, type IRouter } from "express";
import { db, dptSettingsTable, recipesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

function mapRow(r: typeof dptSettingsTable.$inferSelect & { recipeName?: string | null }) {
  return {
    ...r,
    defaultBatchesPerDay: Number(r.defaultBatchesPerDay),
    recipeName: r.recipeName ?? "",
    updatedAt: r.updatedAt.toISOString(),
  };
}

router.get("/", async (_req, res) => {
  const rows = await db
    .select({
      id: dptSettingsTable.id,
      recipeId: dptSettingsTable.recipeId,
      recipeName: recipesTable.name,
      defaultBatchesPerDay: dptSettingsTable.defaultBatchesPerDay,
      isActive: dptSettingsTable.isActive,
      updatedAt: dptSettingsTable.updatedAt,
    })
    .from(dptSettingsTable)
    .leftJoin(recipesTable, eq(dptSettingsTable.recipeId, recipesTable.id))
    .orderBy(recipesTable.name);
  res.json(rows.map(mapRow));
});

router.post("/", async (req, res) => {
  const { recipeId, defaultBatchesPerDay, isActive } = req.body;
  const [row] = await db.insert(dptSettingsTable).values({
    recipeId: Number(recipeId),
    defaultBatchesPerDay: String(defaultBatchesPerDay ?? 0),
    isActive: isActive !== undefined ? Boolean(isActive) : true,
  }).returning();
  const recipeName = await db.select({ name: recipesTable.name }).from(recipesTable).where(eq(recipesTable.id, row.recipeId));
  res.status(201).json(mapRow({ ...row, recipeName: recipeName[0]?.name ?? null }));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { defaultBatchesPerDay, isActive } = req.body;

  const setData: Partial<typeof dptSettingsTable.$inferInsert> = { updatedAt: new Date() };
  if (defaultBatchesPerDay !== undefined) setData.defaultBatchesPerDay = String(defaultBatchesPerDay);
  if (isActive !== undefined) setData.isActive = Boolean(isActive);

  const [row] = await db.update(dptSettingsTable)
    .set(setData)
    .where(eq(dptSettingsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const recipeName = await db.select({ name: recipesTable.name }).from(recipesTable).where(eq(recipesTable.id, row.recipeId));
  res.json(mapRow({ ...row, recipeName: recipeName[0]?.name ?? null }));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(dptSettingsTable).where(eq(dptSettingsTable.id, id));
  res.status(204).send();
});

// Upsert by recipeId
router.put("/by-recipe/:recipeId", async (req, res) => {
  const recipeId = Number(req.params.recipeId);
  const { defaultBatchesPerDay, isActive } = req.body;

  const existing = await db.select().from(dptSettingsTable).where(eq(dptSettingsTable.recipeId, recipeId));
  let row;
  if (existing.length > 0) {
    const setData: Partial<typeof dptSettingsTable.$inferInsert> = { updatedAt: new Date() };
    if (defaultBatchesPerDay !== undefined) setData.defaultBatchesPerDay = String(defaultBatchesPerDay);
    if (isActive !== undefined) setData.isActive = Boolean(isActive);
    [row] = await db.update(dptSettingsTable)
      .set(setData)
      .where(eq(dptSettingsTable.recipeId, recipeId))
      .returning();
  } else {
    [row] = await db.insert(dptSettingsTable).values({
      recipeId,
      defaultBatchesPerDay: String(defaultBatchesPerDay ?? 0),
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    }).returning();
  }
  const recipeName = await db.select({ name: recipesTable.name }).from(recipesTable).where(eq(recipesTable.id, recipeId));
  res.json(mapRow({ ...row, recipeName: recipeName[0]?.name ?? null }));
});

export default router;

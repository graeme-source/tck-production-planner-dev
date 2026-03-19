import { Router, type IRouter } from "express";
import { db, timingStandardsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

function mapRow(r: typeof timingStandardsTable.$inferSelect) {
  return {
    ...r,
    minBatchesPerHour: Number(r.minBatchesPerHour),
    targetBatchesPerHour: Number(r.targetBatchesPerHour),
    updatedAt: r.updatedAt.toISOString(),
  };
}

router.get("/", async (_req, res) => {
  const rows = await db.select().from(timingStandardsTable).orderBy(timingStandardsTable.stationLabel);
  res.json(rows.map(mapRow));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { minBatchesPerHour, targetBatchesPerHour } = req.body;

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (minBatchesPerHour !== undefined) updateData.minBatchesPerHour = String(minBatchesPerHour);
  if (targetBatchesPerHour !== undefined) updateData.targetBatchesPerHour = String(targetBatchesPerHour);

  const [row] = await db.update(timingStandardsTable)
    .set(updateData as Parameters<typeof db.update>[0])
    .where(eq(timingStandardsTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

export default router;

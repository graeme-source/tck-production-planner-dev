import { Router, type IRouter } from "express";
import { db, timingStandardsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

function mapRow(r: typeof timingStandardsTable.$inferSelect) {
  return {
    ...r,
    minBatchesPerHour: Number(r.minBatchesPerHour),
    targetBatchesPerHour: Number(r.targetBatchesPerHour),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const CreateTimingStandardBody = z.object({
  stationType: z.string().min(1),
  stationLabel: z.string().min(1),
  minBatchesPerHour: z.number().min(0),
  targetBatchesPerHour: z.number().min(0),
});

router.get("/", async (_req, res) => {
  const rows = await db.select().from(timingStandardsTable).orderBy(timingStandardsTable.stationLabel);
  res.json(rows.map(mapRow));
});

router.post("/", validate(CreateTimingStandardBody), async (req, res) => {
  const { stationType, stationLabel, minBatchesPerHour, targetBatchesPerHour } = req.body;
  const [row] = await db.insert(timingStandardsTable).values({
    stationType,
    stationLabel,
    minBatchesPerHour: String(minBatchesPerHour),
    targetBatchesPerHour: String(targetBatchesPerHour),
  }).returning();
  res.status(201).json(mapRow(row));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { minBatchesPerHour, targetBatchesPerHour, stationLabel } = req.body;

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (stationLabel !== undefined) updateData.stationLabel = stationLabel;
  if (minBatchesPerHour !== undefined) updateData.minBatchesPerHour = String(minBatchesPerHour);
  if (targetBatchesPerHour !== undefined) updateData.targetBatchesPerHour = String(targetBatchesPerHour);

  const [row] = await db.update(timingStandardsTable)
    .set(updateData as Parameters<typeof db.update>[0])
    .where(eq(timingStandardsTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(timingStandardsTable).where(eq(timingStandardsTable.id, id));
  res.status(204).send();
});

export default router;

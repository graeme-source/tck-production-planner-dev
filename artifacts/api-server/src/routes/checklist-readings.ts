/**
 * Checklist readings (issues #87 and #169, Objective D) — mounted at
 * /api/checklist-readings.
 *
 *   GET /?planId=&stationType=   the readings already taken on a station's
 *                                checklist for that plan (anyone signed in)
 *   PUT /                        record or correct one reading (autosaved
 *                                from the station checklist; needs today's PIN)
 *   GET /log?from=&to=           every reading in a London date range, for
 *                                Analytics -> HACCP (managers and admins)
 *
 * An item asks for a reading when its template has a reading unit
 * (migration 0227). Rules: lib/checklist-readings.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, checklistTemplatesTable, checklistReadingsTable, usersTable } from "@workspace/db";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import * as z from "zod";
import { validate, validateQuery } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { resolveChecklistStation } from "./checklists";
import { asksForReading, normaliseReadingLabels, readingInRange } from "../lib/checklist-readings";
import { londonDaysWindowUtc } from "../lib/london-time";

const router: IRouter = Router();

type ReadingRow = typeof checklistReadingsTable.$inferSelect;

function toApi(r: ReadingRow) {
  return {
    id: r.id,
    templateId: r.templateId,
    planId: r.planId,
    stationType: r.stationType,
    label: r.label,
    value: Number(r.value),
    unit: r.unit,
    expectedMin: r.expectedMin == null ? null : Number(r.expectedMin),
    expectedMax: r.expectedMax == null ? null : Number(r.expectedMax),
    inRange: r.inRange,
    recordedByName: r.recordedByName,
    recordedAt: r.recordedAt.toISOString(),
  };
}

const PlanQuery = z.object({
  planId: z.coerce.number().int().positive(),
  stationType: z.string().min(1).max(64),
});

router.get("/", validateQuery(PlanQuery), async (_req: Request, res: Response) => {
  const { planId, stationType } = res.locals["query"] as z.infer<typeof PlanQuery>;
  const rows = await db.select().from(checklistReadingsTable)
    .where(and(
      eq(checklistReadingsTable.planId, planId),
      eq(checklistReadingsTable.stationType, resolveChecklistStation(stationType)),
    ))
    .orderBy(asc(checklistReadingsTable.templateId), asc(checklistReadingsTable.id));
  res.json({ readings: rows.map(toApi) });
});

const RecordBody = z.object({
  templateId: z.number().int().positive(),
  planId: z.number().int().positive(),
  stationType: z.string().min(1).max(64),
  label: z.string().max(80).default(""),
  value: z.number().finite().min(-99_999_999).max(99_999_999),
});

router.put("/", validate(RecordBody), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof RecordBody>;
  const [t] = await db.select().from(checklistTemplatesTable).where(eq(checklistTemplatesTable.id, body.templateId));
  if (!t) { res.status(404).json({ error: "Checklist item not found" }); return; }
  if (!asksForReading(t.readingUnit)) { res.status(400).json({ error: "This checklist item doesn't take a reading" }); return; }
  const label = body.label.trim();
  if (!normaliseReadingLabels(t.readingLabels).includes(label)) {
    res.status(400).json({ error: `"${label || "(reading)"}" isn't one of this item's readings — reload the checklist` });
    return;
  }

  let userName = "Unknown";
  if (req.session.userId) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (u) userName = u.name;
  }
  const value = Math.round(body.value * 100) / 100;
  const min = t.readingMin == null ? null : Number(t.readingMin);
  const max = t.readingMax == null ? null : Number(t.readingMax);
  const values = {
    templateId: t.id,
    planId: body.planId,
    stationType: resolveChecklistStation(body.stationType),
    label,
    value: String(value),
    unit: (t.readingUnit ?? "").trim(),
    expectedMin: t.readingMin,
    expectedMax: t.readingMax,
    inRange: readingInRange(value, min, max),
    recordedBy: req.session.userId ?? null,
    recordedByName: userName,
  };
  // A corrected typo replaces the reading and re-stamps who/when.
  const [row] = await db.insert(checklistReadingsTable).values(values)
    .onConflictDoUpdate({
      target: [checklistReadingsTable.templateId, checklistReadingsTable.planId, checklistReadingsTable.label],
      set: { ...values, recordedAt: sql`NOW()` },
    })
    .returning();
  res.json({ reading: toApi(row!) });
});

const LogQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.get("/log", requireManagerOrAdmin, validateQuery(LogQuery), async (_req: Request, res: Response) => {
  const { from, to } = res.locals["query"] as z.infer<typeof LogQuery>;
  const { start, end } = londonDaysWindowUtc(from, to);
  const rows = await db.select({
    reading: checklistReadingsTable,
    title: checklistTemplatesTable.title,
  })
    .from(checklistReadingsTable)
    .innerJoin(checklistTemplatesTable, eq(checklistTemplatesTable.id, checklistReadingsTable.templateId))
    .where(and(gte(checklistReadingsTable.recordedAt, start), lt(checklistReadingsTable.recordedAt, end)))
    .orderBy(desc(checklistReadingsTable.recordedAt));
  res.json({ readings: rows.map(r => ({ ...toApi(r.reading), title: r.title })) });
});

export default router;

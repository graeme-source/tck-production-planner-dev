/**
 * Defects (Graeme, 2026-10-01; Objectives E and F) — mounted at /api/defects.
 *
 *   GET    /types            every defect type (active and switched off)
 *   POST   /types            admin: add a type
 *   PATCH  /types/:id        admin: rename / switch on or off / reorder
 *   GET    /options          recipes for the record form's picker
 *   GET    /summary          the KPI for ?period=today|week|month or ?from=&to=
 *   GET    /                 recorded defects for the same ranges, newest first
 *   POST   /                 anyone signed in: record a defect
 *   PATCH  /:id              managers, admins, or whoever recorded it
 *   DELETE /:id              same people; soft delete (deleted_at)
 *
 * The KPI maths is pure and tested in lib/defects-kpi.ts; the loading is
 * shared with the meetings in services/defects-summary.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, defectsTable, defectTypesTable, recipesTable, usersTable } from "@workspace/db";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { requireAdmin } from "../middleware/roles";
import { londonDateString } from "../lib/london-time";
import { canEditDefect, standardPeriods } from "../lib/defects-kpi";
import { loadDefectSummary } from "../services/defects-summary";
import { daysBetween } from "../lib/team-efficiency-labour";

const router: IRouter = Router();

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isRealDay = (s: string) => ISO_DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const Day = z.string().refine(isRealDay, "Dates look like 2026-09-30");

/** Longest range one request may ask for — a year and a bit. */
const MAX_RANGE_DAYS = 400;

const RangeQuery = z.object({ from: Day, to: Day }).refine(r => r.from <= r.to, "from must be on or before to")
  .refine(r => daysBetween(r.from, r.to) <= MAX_RANGE_DAYS, `At most ${MAX_RANGE_DAYS} days at a time`);

async function me(req: Request): Promise<{ id: number; name: string | null; role: string | null }> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? null, role: u?.role ?? null };
}

const PeriodQuery = z.object({ period: z.enum(["today", "week", "month"]) });

/** ?period=today|week|month (worked out here, in London time) or ?from=&to=. */
function parseRange(req: Request, res: Response): { from: string; to: string } | null {
  const period = PeriodQuery.safeParse(req.query);
  if (period.success) return standardPeriods(londonDateString())[period.data.period];
  const parsed = RangeQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Pick a valid date range" });
    return null;
  }
  return parsed.data;
}

// ── Types ──────────────────────────────────────────────────────────────────

router.get("/types", async (_req: Request, res: Response) => {
  const types = await db.select({
    id: defectTypesTable.id, name: defectTypesTable.name, active: defectTypesTable.active, sortOrder: defectTypesTable.sortOrder,
  }).from(defectTypesTable).orderBy(asc(defectTypesTable.sortOrder), asc(defectTypesTable.id));
  res.json({ types });
});

const TypeName = z.string().trim().min(1, "Give the type a name").max(80);
const CreateTypeBody = z.object({ name: TypeName });
const UpdateTypeBody = z.object({
  name: TypeName.optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

router.post("/types", requireAdmin, validate(CreateTypeBody), async (req: Request, res: Response) => {
  const { name } = req.body as z.infer<typeof CreateTypeBody>;
  try {
    const [{ next }] = (await db.execute<{ next: number }>(sql`SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM defect_types`)).rows;
    const [row] = await db.insert(defectTypesTable).values({ name: name.trim(), sortOrder: Number(next) }).returning();
    res.status(201).json({ type: row });
  } catch (err) {
    if (isUniqueViolation(err)) { res.status(409).json({ error: "There's already a type with that name" }); return; }
    console.error("[defects] add type failed:", err);
    res.status(500).json({ error: "Couldn't add the type" });
  }
});

router.patch("/types/:id", requireAdmin, validate(UpdateTypeBody), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid type" }); return; }
  const body = req.body as z.infer<typeof UpdateTypeBody>;
  const patch: Partial<typeof defectTypesTable.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.active !== undefined) patch.active = body.active;
  if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
  try {
    const [row] = await db.update(defectTypesTable).set(patch).where(eq(defectTypesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Type not found" }); return; }
    res.json({ type: row });
  } catch (err) {
    if (isUniqueViolation(err)) { res.status(409).json({ error: "There's already a type with that name" }); return; }
    console.error("[defects] update type failed:", err);
    res.status(500).json({ error: "Couldn't save the type" });
  }
});

// ── Options for the record form ───────────────────────────────────────────

router.get("/options", async (_req: Request, res: Response) => {
  // Archived recipes (migration 0141) aren't offered; a defect already
  // recorded against one keeps its name via recipeName on the record.
  const recipes = await db.select({ id: recipesTable.id, name: recipesTable.name, category: recipesTable.category })
    .from(recipesTable).where(isNull(recipesTable.archivedAt)).orderBy(asc(recipesTable.name));
  res.json({ recipes });
});

// ── KPI ────────────────────────────────────────────────────────────────────

router.get("/summary", async (req: Request, res: Response) => {
  const range = parseRange(req, res);
  if (!range) return;
  const { from, to } = range;
  try {
    res.json(await loadDefectSummary(from, to));
  } catch (err) {
    console.error("[defects] summary failed:", err);
    res.status(500).json({ error: "Couldn't work out the defect numbers" });
  }
});

// ── Recorded defects ──────────────────────────────────────────────────────

router.get("/", async (req: Request, res: Response) => {
  const range = parseRange(req, res);
  if (!range) return;
  const user = await me(req);
  const rows = await db.select({
    id: defectsTable.id,
    occurredOn: defectsTable.occurredOn,
    defectTypeId: defectsTable.defectTypeId,
    typeName: defectTypesTable.name,
    recipeId: defectsTable.recipeId,
    recipeName: recipesTable.name,
    packs: defectsTable.packs,
    station: defectsTable.station,
    orderRefs: defectsTable.orderRefs,
    note: defectsTable.note,
    recordedById: defectsTable.recordedById,
    recordedByName: defectsTable.recordedByName,
    updatedByName: defectsTable.updatedByName,
    createdAt: defectsTable.createdAt,
    updatedAt: defectsTable.updatedAt,
  })
    .from(defectsTable)
    .innerJoin(defectTypesTable, eq(defectTypesTable.id, defectsTable.defectTypeId))
    .leftJoin(recipesTable, eq(recipesTable.id, defectsTable.recipeId))
    .where(and(isNull(defectsTable.deletedAt), gte(defectsTable.occurredOn, range.from), lte(defectsTable.occurredOn, range.to)))
    .orderBy(desc(defectsTable.occurredOn), desc(defectsTable.createdAt))
    .limit(500);
  res.json({ defects: rows.map(r => ({ ...r, canEdit: canEditDefect(user, r) })) });
});

const Optional = (max: number) => z.string().trim().max(max).nullable().optional();
const DefectFields = {
  occurredOn: Day,
  defectTypeId: z.number().int().positive(),
  recipeId: z.number().int().positive().nullable().optional(),
  packs: z.number().int().min(1, "At least 1 pack").max(100000),
  station: Optional(60),
  orderRefs: Optional(300),
  note: Optional(2000),
};
const CreateDefectBody = z.object(DefectFields);
const UpdateDefectBody = z.object(DefectFields).partial();

const blankToNull = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());

async function checkTypeAndDay(
  body: { occurredOn?: string; defectTypeId?: number },
  opts: { mustBeActive: boolean },
): Promise<string | null> {
  if (body.occurredOn && body.occurredOn > londonDateString()) return "A defect can't be recorded for a day that hasn't happened yet";
  if (body.defectTypeId !== undefined) {
    const [t] = await db.select({ active: defectTypesTable.active }).from(defectTypesTable).where(eq(defectTypesTable.id, body.defectTypeId));
    if (!t) return "That defect type doesn't exist";
    if (opts.mustBeActive && !t.active) return "That defect type has been switched off";
  }
  return null;
}

router.post("/", validate(CreateDefectBody), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof CreateDefectBody>;
  const problem = await checkTypeAndDay(body, { mustBeActive: true });
  if (problem) { res.status(400).json({ error: problem }); return; }
  const user = await me(req);
  try {
    const [row] = await db.insert(defectsTable).values({
      occurredOn: body.occurredOn,
      defectTypeId: body.defectTypeId,
      recipeId: body.recipeId ?? null,
      packs: body.packs,
      station: blankToNull(body.station),
      orderRefs: blankToNull(body.orderRefs),
      note: blankToNull(body.note),
      recordedById: user.id,
      recordedByName: user.name,
    }).returning();
    res.status(201).json({ defect: row });
  } catch (err) {
    console.error("[defects] record failed:", err);
    res.status(500).json({ error: "Couldn't save the defect" });
  }
});

async function loadEditable(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid defect" }); return null; }
  const [row] = await db.select({ id: defectsTable.id, recordedById: defectsTable.recordedById, defectTypeId: defectsTable.defectTypeId })
    .from(defectsTable).where(and(eq(defectsTable.id, id), isNull(defectsTable.deletedAt)));
  if (!row) { res.status(404).json({ error: "Defect not found" }); return null; }
  const user = await me(req);
  if (!canEditDefect(user, row)) {
    res.status(403).json({ error: "Only a manager or the person who recorded it can change this" });
    return null;
  }
  return { row, user };
}

router.patch("/:id", validate(UpdateDefectBody), async (req: Request, res: Response) => {
  const found = await loadEditable(req, res);
  if (!found) return;
  const body = req.body as z.infer<typeof UpdateDefectBody>;
  // Keeping a record's existing (now switched-off) type is fine; switching TO
  // a switched-off type is not.
  const changingType = body.defectTypeId !== undefined && body.defectTypeId !== found.row.defectTypeId;
  const problem = await checkTypeAndDay(
    { occurredOn: body.occurredOn, defectTypeId: changingType ? body.defectTypeId : undefined },
    { mustBeActive: true },
  );
  if (problem) { res.status(400).json({ error: problem }); return; }

  const patch: Partial<typeof defectsTable.$inferInsert> = {
    updatedAt: new Date(), updatedById: found.user.id, updatedByName: found.user.name,
  };
  if (body.occurredOn !== undefined) patch.occurredOn = body.occurredOn;
  if (body.defectTypeId !== undefined) patch.defectTypeId = body.defectTypeId;
  if (body.recipeId !== undefined) patch.recipeId = body.recipeId ?? null;
  if (body.packs !== undefined) patch.packs = body.packs;
  if (body.station !== undefined) patch.station = blankToNull(body.station);
  if (body.orderRefs !== undefined) patch.orderRefs = blankToNull(body.orderRefs);
  if (body.note !== undefined) patch.note = blankToNull(body.note);
  const [row] = await db.update(defectsTable).set(patch).where(eq(defectsTable.id, found.row.id)).returning();
  res.json({ defect: row });
});

router.delete("/:id", async (req: Request, res: Response) => {
  const found = await loadEditable(req, res);
  if (!found) return;
  await db.update(defectsTable)
    .set({ deletedAt: new Date(), deletedById: found.user.id, deletedByName: found.user.name })
    .where(eq(defectsTable.id, found.row.id));
  res.json({ ok: true });
});

export default router;

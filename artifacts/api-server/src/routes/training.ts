// Training matrix — onboarding & training sign-off.
//
// A matrix is a grid: enrolled app users (rows) × training items (columns),
// with a per-cell sign-off (trained yes/no + date + who signed off). Items are
// either free-text or linked to a live SOP in the Documents repository
// (risk_assessments where assessment_type = 'sop'). The whole router is gated
// to admins/managers in routes/index.ts.

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  usersTable,
  riskAssessmentsTable,
  trainingMatricesTable,
  trainingMatrixItemsTable,
  trainingMatrixEnrolmentsTable,
  trainingRecordsTable,
} from "@workspace/db";
import { eq, and, asc, desc, sql } from "drizzle-orm";

const router: IRouter = Router();

async function currentUser(req: Request): Promise<{ id: number; name: string } | null> {
  const id = req.session.userId ?? null;
  if (!id) return null;
  const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return u ?? null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Matrices ───────────────────────────────────────────────────────────────

// GET /matrices — list with item + enrolment counts (cards view).
router.get("/matrices", async (_req: Request, res: Response) => {
  try {
    const matrices = await db.select().from(trainingMatricesTable).orderBy(desc(trainingMatricesTable.updatedAt));
    const itemCounts = await db
      .select({ matrixId: trainingMatrixItemsTable.matrixId, n: sql<number>`count(*)::int` })
      .from(trainingMatrixItemsTable)
      .groupBy(trainingMatrixItemsTable.matrixId);
    const enrolCounts = await db
      .select({ matrixId: trainingMatrixEnrolmentsTable.matrixId, n: sql<number>`count(*)::int` })
      .from(trainingMatrixEnrolmentsTable)
      .groupBy(trainingMatrixEnrolmentsTable.matrixId);
    const items = new Map(itemCounts.map(r => [r.matrixId, r.n]));
    const enrols = new Map(enrolCounts.map(r => [r.matrixId, r.n]));
    res.json(matrices.map(m => ({ ...m, itemCount: items.get(m.id) ?? 0, peopleCount: enrols.get(m.id) ?? 0 })));
  } catch (err) {
    console.error("[training] list matrices failed:", err);
    res.status(500).json({ error: "Failed to load training matrices" });
  }
});

// GET /matrices/:id — full payload that powers the grid.
router.get("/matrices/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [matrix] = await db.select().from(trainingMatricesTable).where(eq(trainingMatricesTable.id, id));
    if (!matrix) { res.status(404).json({ error: "Matrix not found" }); return; }

    const items = await db
      .select({
        id: trainingMatrixItemsTable.id,
        label: trainingMatrixItemsTable.label,
        sopId: trainingMatrixItemsTable.sopId,
        sortOrder: trainingMatrixItemsTable.sortOrder,
        sopTitle: riskAssessmentsTable.title,
        sopFileSizeBytes: riskAssessmentsTable.fileSizeBytes,
      })
      .from(trainingMatrixItemsTable)
      .leftJoin(riskAssessmentsTable, eq(trainingMatrixItemsTable.sopId, riskAssessmentsTable.id))
      .where(eq(trainingMatrixItemsTable.matrixId, id))
      .orderBy(asc(trainingMatrixItemsTable.sortOrder), asc(trainingMatrixItemsTable.id));

    const enrolments = await db
      .select({
        enrolmentId: trainingMatrixEnrolmentsTable.id,
        userId: usersTable.id,
        name: usersTable.name,
        role: usersTable.role,
        avatarUrl: usersTable.avatarUrl,
        sortOrder: trainingMatrixEnrolmentsTable.sortOrder,
      })
      .from(trainingMatrixEnrolmentsTable)
      .innerJoin(usersTable, eq(trainingMatrixEnrolmentsTable.userId, usersTable.id))
      .where(eq(trainingMatrixEnrolmentsTable.matrixId, id))
      .orderBy(asc(trainingMatrixEnrolmentsTable.sortOrder), asc(usersTable.name));

    const records = await db
      .select({
        itemId: trainingRecordsTable.itemId,
        userId: trainingRecordsTable.userId,
        trained: trainingRecordsTable.trained,
        trainedAt: trainingRecordsTable.trainedAt,
        signedOffByName: trainingRecordsTable.signedOffByName,
      })
      .from(trainingRecordsTable)
      .innerJoin(trainingMatrixItemsTable, eq(trainingRecordsTable.itemId, trainingMatrixItemsTable.id))
      .where(eq(trainingMatrixItemsTable.matrixId, id));

    res.json({ matrix, items, enrolments, records });
  } catch (err) {
    console.error("[training] get matrix failed:", err);
    res.status(500).json({ error: "Failed to load training matrix" });
  }
});

// POST /matrices — create a matrix.
router.post("/matrices", async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    const description = req.body?.description ? String(req.body.description).trim() : null;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const me = await currentUser(req);
    const [row] = await db
      .insert(trainingMatricesTable)
      .values({ name, description, createdByUserId: me?.id ?? null, createdByName: me?.name ?? null })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[training] create matrix failed:", err);
    res.status(500).json({ error: "Failed to create training matrix" });
  }
});

// PUT /matrices/:id — rename / re-describe.
router.put("/matrices/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const name = String(req.body?.name ?? "").trim();
    const description = req.body?.description ? String(req.body.description).trim() : null;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [row] = await db
      .update(trainingMatricesTable)
      .set({ name, description, updatedAt: new Date() })
      .where(eq(trainingMatricesTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Matrix not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[training] update matrix failed:", err);
    res.status(500).json({ error: "Failed to update training matrix" });
  }
});

// DELETE /matrices/:id — items, enrolments and records cascade.
router.delete("/matrices/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const del = await db.delete(trainingMatricesTable).where(eq(trainingMatricesTable.id, id)).returning({ id: trainingMatricesTable.id });
    if (del.length === 0) { res.status(404).json({ error: "Matrix not found" }); return; }
    res.status(204).send();
  } catch (err) {
    console.error("[training] delete matrix failed:", err);
    res.status(500).json({ error: "Failed to delete training matrix" });
  }
});

// ─── Items ────────────────────────────────────────────────────────────────────

// POST /matrices/:id/items — add an item (free-text or SOP-linked).
router.post("/matrices/:id/items", async (req: Request, res: Response) => {
  const matrixId = Number(req.params.id);
  if (!Number.isInteger(matrixId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const sopId = req.body?.sopId != null && req.body.sopId !== "" ? Number(req.body.sopId) : null;
    if (sopId != null && !Number.isInteger(sopId)) { res.status(400).json({ error: "Invalid sopId" }); return; }

    let label = String(req.body?.label ?? "").trim();
    if (!label && sopId != null) {
      const [sop] = await db.select({ title: riskAssessmentsTable.title }).from(riskAssessmentsTable).where(eq(riskAssessmentsTable.id, sopId));
      label = sop?.title ?? "";
    }
    if (!label) { res.status(400).json({ error: "label is required" }); return; }

    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${trainingMatrixItemsTable.sortOrder}), -1)::int` })
      .from(trainingMatrixItemsTable)
      .where(eq(trainingMatrixItemsTable.matrixId, matrixId));

    const [row] = await db
      .insert(trainingMatrixItemsTable)
      .values({ matrixId, label, sopId, sortOrder: (max ?? -1) + 1 })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[training] add item failed:", err);
    res.status(500).json({ error: "Failed to add item" });
  }
});

// PUT /items/:itemId — edit label / SOP link.
router.put("/items/:itemId", async (req: Request, res: Response) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(itemId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const sopId = req.body?.sopId != null && req.body.sopId !== "" ? Number(req.body.sopId) : null;
    if (sopId != null && !Number.isInteger(sopId)) { res.status(400).json({ error: "Invalid sopId" }); return; }
    const label = String(req.body?.label ?? "").trim();
    if (!label) { res.status(400).json({ error: "label is required" }); return; }
    const [row] = await db
      .update(trainingMatrixItemsTable)
      .set({ label, sopId })
      .where(eq(trainingMatrixItemsTable.id, itemId))
      .returning();
    if (!row) { res.status(404).json({ error: "Item not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[training] update item failed:", err);
    res.status(500).json({ error: "Failed to update item" });
  }
});

// DELETE /items/:itemId — records cascade.
router.delete("/items/:itemId", async (req: Request, res: Response) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(itemId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const del = await db.delete(trainingMatrixItemsTable).where(eq(trainingMatrixItemsTable.id, itemId)).returning({ id: trainingMatrixItemsTable.id });
    if (del.length === 0) { res.status(404).json({ error: "Item not found" }); return; }
    res.status(204).send();
  } catch (err) {
    console.error("[training] delete item failed:", err);
    res.status(500).json({ error: "Failed to delete item" });
  }
});

// ─── Enrolments ──────────────────────────────────────────────────────────────

// POST /matrices/:id/enrolments — enrol an app user as a row.
router.post("/matrices/:id/enrolments", async (req: Request, res: Response) => {
  const matrixId = Number(req.params.id);
  if (!Number.isInteger(matrixId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const userId = Number(req.body?.userId);
    if (!Number.isInteger(userId)) { res.status(400).json({ error: "userId is required" }); return; }

    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${trainingMatrixEnrolmentsTable.sortOrder}), -1)::int` })
      .from(trainingMatrixEnrolmentsTable)
      .where(eq(trainingMatrixEnrolmentsTable.matrixId, matrixId));

    const [row] = await db
      .insert(trainingMatrixEnrolmentsTable)
      .values({ matrixId, userId, sortOrder: (max ?? -1) + 1 })
      .onConflictDoNothing({ target: [trainingMatrixEnrolmentsTable.matrixId, trainingMatrixEnrolmentsTable.userId] })
      .returning();
    res.status(201).json(row ?? { ok: true, alreadyEnrolled: true });
  } catch (err) {
    console.error("[training] enrol failed:", err);
    res.status(500).json({ error: "Failed to enrol user" });
  }
});

// DELETE /enrolments/:enrolmentId — remove a row (records for that user remain).
router.delete("/enrolments/:enrolmentId", async (req: Request, res: Response) => {
  const enrolmentId = Number(req.params.enrolmentId);
  if (!Number.isInteger(enrolmentId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const del = await db.delete(trainingMatrixEnrolmentsTable).where(eq(trainingMatrixEnrolmentsTable.id, enrolmentId)).returning({ id: trainingMatrixEnrolmentsTable.id });
    if (del.length === 0) { res.status(404).json({ error: "Enrolment not found" }); return; }
    res.status(204).send();
  } catch (err) {
    console.error("[training] remove enrolment failed:", err);
    res.status(500).json({ error: "Failed to remove enrolment" });
  }
});

// ─── Records (cells) ──────────────────────────────────────────────────────────

// PUT /records — upsert a cell. trained:true stamps date (today if omitted) and signer.
router.put("/records", async (req: Request, res: Response) => {
  try {
    const itemId = Number(req.body?.itemId);
    const userId = Number(req.body?.userId);
    const trained = req.body?.trained === true;
    if (!Number.isInteger(itemId) || !Number.isInteger(userId)) {
      res.status(400).json({ error: "itemId and userId are required" });
      return;
    }
    const me = await currentUser(req);
    const trainedAt = trained ? (req.body?.trainedAt ? String(req.body.trainedAt) : todayIso()) : null;
    const signedOffByUserId = trained ? (me?.id ?? null) : null;
    const signedOffByName = trained ? (me?.name ?? null) : null;

    const [row] = await db
      .insert(trainingRecordsTable)
      .values({ itemId, userId, trained, trainedAt, signedOffByUserId, signedOffByName })
      .onConflictDoUpdate({
        target: [trainingRecordsTable.itemId, trainingRecordsTable.userId],
        set: { trained, trainedAt, signedOffByUserId, signedOffByName, updatedAt: new Date() },
      })
      .returning();
    res.json(row);
  } catch (err) {
    console.error("[training] upsert record failed:", err);
    res.status(500).json({ error: "Failed to save training record" });
  }
});

export default router;

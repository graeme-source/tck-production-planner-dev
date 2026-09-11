// Self-service training acknowledgement (Graeme, 2026-09-11).
//
// The training matrix's sign-off used to be manager-only, which forced a
// manual loop for read-and-understood items: colleague reads the policy,
// tells a manager, manager opens the matrix and ticks the cell. This router
// closes that loop from the document itself: when the signed-in colleague
// is enrolled in a matrix item linked to the document they're reading, the
// document viewer offers "I've read and understood" and the tick lands on
// the matrix immediately, recorded as a self-confirmation.
//
// Mounted WITHOUT the admin/manager guard (unlike /training) — the whole
// point is that any colleague can confirm their own reading. Everything
// here is scoped to the session user; nobody can tick anyone else's cell.

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  usersTable,
  trainingMatricesTable,
  trainingMatrixItemsTable,
  trainingMatrixEnrolmentsTable,
  trainingRecordsTable,
} from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The session user's training items linked to one document: is this
 *  document on my matrix, and have I already confirmed it? */
async function myItemsForDocument(userId: number, documentId: number) {
  return db
    .select({
      itemId: trainingMatrixItemsTable.id,
      itemLabel: trainingMatrixItemsTable.label,
      matrixName: trainingMatricesTable.name,
      trained: trainingRecordsTable.trained,
      trainedAt: trainingRecordsTable.trainedAt,
      signedOffByName: trainingRecordsTable.signedOffByName,
    })
    .from(trainingMatrixItemsTable)
    .innerJoin(trainingMatricesTable, eq(trainingMatrixItemsTable.matrixId, trainingMatricesTable.id))
    .innerJoin(
      trainingMatrixEnrolmentsTable,
      and(
        eq(trainingMatrixEnrolmentsTable.matrixId, trainingMatrixItemsTable.matrixId),
        eq(trainingMatrixEnrolmentsTable.userId, userId),
      ),
    )
    .leftJoin(
      trainingRecordsTable,
      and(
        eq(trainingRecordsTable.itemId, trainingMatrixItemsTable.id),
        eq(trainingRecordsTable.userId, userId),
      ),
    )
    .where(eq(trainingMatrixItemsTable.sopId, documentId))
    .orderBy(asc(trainingMatrixItemsTable.id));
}

// GET /status?documentId=N — does this document appear on MY training
// matrix, and where do I stand on it? Powers the button in the viewer.
router.get("/status", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const documentId = Number(req.query.documentId);
  if (!Number.isInteger(documentId)) { res.status(400).json({ error: "documentId is required" }); return; }
  try {
    const items = await myItemsForDocument(userId, documentId);
    res.json({ items });
  } catch (err) {
    console.error("[training-ack] status failed:", err);
    res.status(500).json({ error: "Failed to load training status" });
  }
});

// POST /confirm { documentId } — tick every one of MY unticked matrix items
// linked to this document, recorded as a self-confirmation with today's
// date. Idempotent: already-ticked items are left exactly as they are (a
// manager's earlier sign-off is never overwritten).
router.post("/confirm", validate(z.object({ documentId: z.number().int() })), async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { documentId } = req.body as { documentId: number };
  try {
    const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }

    const items = await myItemsForDocument(userId, documentId);
    if (items.length === 0) {
      res.status(404).json({ error: "This document isn't on your training matrix" });
      return;
    }

    const signedOffByName = `${user.name} (read & confirmed in app)`;
    for (const item of items) {
      if (item.trained) continue;
      await db
        .insert(trainingRecordsTable)
        .values({
          itemId: item.itemId,
          userId,
          trained: true,
          trainedAt: todayIso(),
          signedOffByUserId: userId,
          signedOffByName,
        })
        .onConflictDoUpdate({
          target: [trainingRecordsTable.itemId, trainingRecordsTable.userId],
          set: {
            trained: true,
            trainedAt: todayIso(),
            signedOffByUserId: userId,
            signedOffByName,
            updatedAt: new Date(),
          },
        });
    }

    res.json({ items: await myItemsForDocument(userId, documentId) });
  } catch (err) {
    console.error("[training-ack] confirm failed:", err);
    res.status(500).json({ error: "Failed to record your confirmation" });
  }
});

export default router;

/**
 * Letters sent to ME (Graeme, 2026-10-12: "generate letters and send them
 * to employees to inform them of important updates such as written
 * warnings"). The employee's side — session only, no user parameter, and
 * NOT behind the People PIN (like /api/person-documents/mine):
 *
 *   GET  /api/people-letters/mine                   my sent letters + their state
 *   POST /api/people-letters/mine/:id/read          I opened it (first time is kept)
 *   POST /api/people-letters/mine/:id/acknowledge   "I've read and understood this letter"
 *
 * The PDF itself comes through /api/person-documents/mine/:id/file — the
 * letter was filed there as a shared document when it was sent. Only SENT
 * letters exist here; a draft or a filed-not-sent letter answers 404.
 * Both writes are the self-service kind own_letter_acknowledge (the shared
 * employmentRecordWrite guard), on your own record only, and land in
 * people_record_audit so the record shows when it was read and acknowledged.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, peopleLettersTable, peopleRecordAuditTable, usersTable } from "@workspace/db";
import { checkLetterAction, type LetterStatus } from "@workspace/people-reviews";
import { validate } from "../middleware/validate";
import { employmentRecordWrite, fromSession } from "../middleware/employment-record-write";

const router: IRouter = Router();

router.get("/mine", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const rows = await db.select({
      id: peopleLettersTable.id, title: peopleLettersTable.title, documentId: peopleLettersTable.documentId,
      sentAt: peopleLettersTable.sentAt, sentByName: peopleLettersTable.sentByName,
      readAt: peopleLettersTable.readAt, acknowledgedAt: peopleLettersTable.acknowledgedAt,
    }).from(peopleLettersTable)
      .where(and(eq(peopleLettersTable.userId, userId), eq(peopleLettersTable.status, "sent")))
      .orderBy(desc(peopleLettersTable.sentAt));
    res.json(rows);
  } catch (err) {
    console.error("[people-letters] mine failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Couldn't load your letters" });
  }
});

async function mark(req: Request, res: Response, action: "read" | "acknowledge") {
  const userId = req.session.userId!;
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(404).json({ error: "No such letter" }); return; }
  try {
    const [l] = await db.select().from(peopleLettersTable).where(eq(peopleLettersTable.id, id));
    // Only YOUR sent letters exist here — anything else is a 404.
    if (!l || l.userId !== userId) { res.status(404).json({ error: "No such letter" }); return; }
    const gate = checkLetterAction({ status: l.status as LetterStatus, acknowledgedAt: l.acknowledgedAt?.toISOString() ?? null }, action);
    if (!gate.ok) {
      if (action === "acknowledge" && l.acknowledgedAt) { res.json({ ok: true, acknowledgedAt: l.acknowledgedAt }); return; }
      res.status(404).json({ error: gate.error });
      return;
    }
    if (action === "read" && l.readAt) { res.json({ ok: true, readAt: l.readAt }); return; }
    const now = new Date();
    const [me] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    await db.transaction(async tx => {
      await tx.update(peopleLettersTable).set(action === "read"
        ? { readAt: now, updatedAt: now }
        : { acknowledgedAt: now, readAt: l.readAt ?? now, updatedAt: now })
        .where(eq(peopleLettersTable.id, l.id));
      await tx.insert(peopleRecordAuditTable).values({
        viewerId: userId, viewerName: me?.name ?? null, subjectUserId: userId, entryId: l.entryId,
        action: action === "read" ? "letter_read" : "letter_ack",
        detail: action === "read" ? `Opened by them: ${l.title}` : `Read and acknowledged by them: ${l.title}`,
      });
    });
    res.json({ ok: true, [action === "read" ? "readAt" : "acknowledgedAt"]: now });
  } catch (err) {
    console.error(`[people-letters] ${action} failed:`, err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Couldn't save that — try again" });
  }
}

router.post("/mine/:id/read",
  employmentRecordWrite({ subject: fromSession, selfService: "own_letter_acknowledge" }),
  validate(z.object({})),
  (req, res) => mark(req, res, "read"));

router.post("/mine/:id/acknowledge",
  employmentRecordWrite({ subject: fromSession, selfService: "own_letter_acknowledge" }),
  validate(z.object({})),
  (req, res) => mark(req, res, "acknowledge"));

export default router;

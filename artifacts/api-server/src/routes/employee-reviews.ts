/**
 * Employee reviews, probation meetings and the ongoing record of someone's
 * time here (Graeme, 2026-09-03).
 *
 * The shape of it:
 *   • MEETINGS are booked for a date and written up afterwards.
 *   • NOTES are the diary — notes, feedback and objectives. Every one is
 *     PRIVATE to its author until deliberately shared to the employee's
 *     record, at which point they get a notification.
 *   • The employee READS their record and never writes to it. It is a record
 *     of what was said, not a conversation.
 *
 * Privacy is enforced HERE, not in the UI: every read runs through
 * visibleNotes() before it leaves the server, so a private note is never sent
 * to a browser that has no business holding it. "Private" means private to
 * whoever wrote it — not to management collectively — so another admin cannot
 * read Graeme's private notes either. A named person can be granted the
 * private side of a record later; that is what hasPrivateGrant is for and it
 * is false today.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, employeeMeetingsTable, employeeNotesTable, usersTable,
  canManageRecord, canOpenRecord, visibleNotes,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

async function sessionUser(req: Request): Promise<{ id: number; role: string; name: string } | null> {
  const id = req.session.userId;
  if (!id) return null;
  const [row] = await db
    .select({ role: usersTable.role, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!row) return null;
  if (!req.session.userRole) req.session.userRole = row.role as "admin" | "manager" | "viewer";
  return { id, role: row.role, name: row.name };
}

/** Notify without ever letting a missed bell fail the action itself. */
async function notify(userId: number, message: string) {
  try {
    await db.execute(sql`
      INSERT INTO notifications (user_id, type, message, read)
      VALUES (${userId}, ${"review"}, ${message.slice(0, 500)}, false)
    `);
  } catch (err) {
    console.warn("[EmployeeReviews] notification insert failed:", err instanceof Error ? err.message : err);
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** Who a manager can open a record for. Managers and admins only — this is
 *  the staff list, and it has no business being enumerable by everyone. */
router.get("/people", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!canManageRecord(user)) { res.status(403).json({ error: "Managers only" }); return; }
  try {
    const rows = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        role: usersTable.role,
        probationMonths: usersTable.probationMonths,
      })
      .from(usersTable)
      .where(eq(usersTable.isActive, true))
      .orderBy(usersTable.name);
    res.json(rows);
  } catch (err) {
    console.error("[EmployeeReviews] people error:", err);
    res.status(500).json({ error: "Failed to load people" });
  }
});

/** One person's record. `me` is the caller's own. */
router.get("/:userId", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const subjectId = req.params.userId === "me" ? user.id : Number(req.params.userId);
  if (!Number.isInteger(subjectId)) { res.status(400).json({ error: "Invalid user id" }); return; }

  // A team member can open their own record and nobody else's.
  if (!canOpenRecord(user, subjectId)) {
    res.status(403).json({ error: "That isn't your record" });
    return;
  }

  try {
    const [subject] = await db
      .select({ id: usersTable.id, name: usersTable.name, probationMonths: usersTable.probationMonths })
      .from(usersTable)
      .where(eq(usersTable.id, subjectId));
    if (!subject) { res.status(404).json({ error: "Not found" }); return; }

    const meetings = await db
      .select()
      .from(employeeMeetingsTable)
      .where(eq(employeeMeetingsTable.subjectUserId, subjectId))
      .orderBy(desc(employeeMeetingsTable.scheduledFor), desc(employeeMeetingsTable.createdAt));

    const allNotes = await db
      .select()
      .from(employeeNotesTable)
      .where(eq(employeeNotesTable.subjectUserId, subjectId))
      .orderBy(desc(employeeNotesTable.createdAt));

    // THE line that matters. Everything below this point has already been
    // filtered to what this person may see.
    const notes = visibleNotes(allNotes, { id: user.id, role: user.role }, subjectId);

    res.json({
      subject,
      canManage: canManageRecord(user),
      isOwnRecord: user.id === subjectId,
      meetings,
      notes,
    });
  } catch (err) {
    console.error("[EmployeeReviews] record error:", err);
    res.status(500).json({ error: "Failed to load the record" });
  }
});

// ── Meetings ───────────────────────────────────────────────────────────────

const MeetingBody = z.object({
  kind: z.enum(["review", "probation", "one_to_one"]).default("review"),
  title: z.string().trim().max(200).optional(),
  scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post("/:userId/meetings", validate(MeetingBody), async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!canManageRecord(user)) { res.status(403).json({ error: "Managers only" }); return; }

  const subjectId = Number(req.params.userId);
  if (!Number.isInteger(subjectId)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const b = req.body as z.infer<typeof MeetingBody>;
  try {
    const [row] = await db.insert(employeeMeetingsTable).values({
      subjectUserId: subjectId,
      kind: b.kind,
      title: b.title || null,
      scheduledFor: b.scheduledFor ?? null,
      createdBy: user.id,
      createdByName: user.name,
    }).returning();

    // The employee is told a meeting exists — the date is theirs to know.
    // Nothing about what will be said in it.
    if (row && subjectId !== user.id && b.scheduledFor) {
      await notify(subjectId, `${user.name} booked a ${b.kind === "one_to_one" ? "1:1" : b.kind} with you on ${b.scheduledFor}`);
    }
    res.status(201).json(row);
  } catch (err) {
    console.error("[EmployeeReviews] book meeting error:", err);
    res.status(500).json({ error: "Failed to book the meeting" });
  }
});

const MeetingPatch = z.object({
  status: z.enum(["booked", "held", "cancelled"]).optional(),
  scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
});

router.patch("/meetings/:id", validate(MeetingPatch), async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!canManageRecord(user)) { res.status(403).json({ error: "Managers only" }); return; }

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const b = req.body as z.infer<typeof MeetingPatch>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (b.status !== undefined) {
    updates.status = b.status;
    // Marking it held stamps when, so the record reads as a history rather
    // than a list of intentions.
    if (b.status === "held") updates.heldAt = new Date();
  }
  if (b.scheduledFor !== undefined) updates.scheduledFor = b.scheduledFor;
  if (b.title !== undefined) updates.title = b.title;

  try {
    const [row] = await db.update(employeeMeetingsTable).set(updates)
      .where(eq(employeeMeetingsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[EmployeeReviews] update meeting error:", err);
    res.status(500).json({ error: "Failed to update the meeting" });
  }
});

// ── Notes, feedback and objectives ─────────────────────────────────────────

const NoteBody = z.object({
  kind: z.enum(["note", "feedback", "objective"]).default("note"),
  body: z.string().trim().min(1).max(10_000),
  // Private unless the author deliberately says otherwise, here or later.
  visibility: z.enum(["private", "shared"]).default("private"),
  meetingId: z.number().int().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

router.post("/:userId/notes", validate(NoteBody), async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!canManageRecord(user)) { res.status(403).json({ error: "Managers only" }); return; }

  const subjectId = Number(req.params.userId);
  if (!Number.isInteger(subjectId)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const b = req.body as z.infer<typeof NoteBody>;
  try {
    const [row] = await db.insert(employeeNotesTable).values({
      subjectUserId: subjectId,
      meetingId: b.meetingId ?? null,
      kind: b.kind,
      body: b.body,
      visibility: b.visibility,
      sharedAt: b.visibility === "shared" ? new Date() : null,
      dueDate: b.dueDate ?? null,
      authorId: user.id,
      authorName: user.name,
    }).returning();

    if (row && b.visibility === "shared" && subjectId !== user.id) {
      await notify(subjectId, `${user.name} shared a note on your record`);
    }
    res.status(201).json(row);
  } catch (err) {
    console.error("[EmployeeReviews] create note error:", err);
    res.status(500).json({ error: "Failed to save the note" });
  }
});

const NotePatch = z.object({
  body: z.string().trim().min(1).max(10_000).optional(),
  visibility: z.enum(["private", "shared"]).optional(),
  done: z.boolean().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/** Edit a note, publish it, or tick an objective off.
 *
 *  Only the author may touch their own note — including publishing it. That
 *  is the whole promise of "private": another manager cannot read it, and so
 *  must not be able to publish it either. */
router.patch("/notes/:id", validate(NotePatch), async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [note] = await db.select().from(employeeNotesTable).where(eq(employeeNotesTable.id, id));
    if (!note) { res.status(404).json({ error: "Not found" }); return; }
    if (note.authorId !== user.id) {
      res.status(403).json({ error: "Only whoever wrote a note can change it" });
      return;
    }

    const b = req.body as z.infer<typeof NotePatch>;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (b.body !== undefined) updates.body = b.body;
    if (b.dueDate !== undefined) updates.dueDate = b.dueDate;
    if (b.done !== undefined) updates.doneAt = b.done ? new Date() : null;
    if (b.visibility !== undefined) {
      updates.visibility = b.visibility;
      // Stamp the first time it is published; taking it back down clears it
      // so the record doesn't claim it is still shared.
      updates.sharedAt = b.visibility === "shared" ? (note.sharedAt ?? new Date()) : null;
    }

    const [row] = await db.update(employeeNotesTable).set(updates)
      .where(eq(employeeNotesTable.id, id)).returning();

    const newlyShared = b.visibility === "shared" && note.visibility !== "shared";
    if (newlyShared && note.subjectUserId !== user.id) {
      await notify(note.subjectUserId, `${user.name} shared a note on your record`);
    }
    res.json(row);
  } catch (err) {
    console.error("[EmployeeReviews] update note error:", err);
    res.status(500).json({ error: "Failed to update the note" });
  }
});

router.delete("/notes/:id", async (req: Request, res: Response) => {
  const user = await sessionUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [note] = await db.select().from(employeeNotesTable).where(eq(employeeNotesTable.id, id));
    if (!note) { res.status(404).json({ error: "Not found" }); return; }
    if (note.authorId !== user.id) {
      res.status(403).json({ error: "Only whoever wrote a note can delete it" });
      return;
    }
    await db.delete(employeeNotesTable).where(eq(employeeNotesTable.id, id));
    console.log(`[EmployeeReviews] note ${id} on user ${note.subjectUserId} deleted by ${user.id}`);
    res.status(204).send();
  } catch (err) {
    console.error("[EmployeeReviews] delete note error:", err);
    res.status(500).json({ error: "Failed to delete the note" });
  }
});

export default router;
